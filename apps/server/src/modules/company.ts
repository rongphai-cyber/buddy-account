import { ADMIN_MENUS, formatDate, isTenantModuleKey, normalizeAppAccess, PLATFORM_MENUS, passwordProblem, normalizeUiTheme, MODULE_SWITCHES, TENANT_MODULES, TENANT_RETENTION_DAYS, tenantCountdown, tenantCountingDown } from '@buddy/core';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';
import { z } from 'zod';
import { checkTaxId, d, todayIso } from '@buddy/core';
import type { Database, Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth, requireCompany, type AuthContext } from '../http.js';
import { canAccessCompany, companiesForUser, requireDemoForProvider, tenantIsDemo } from './auth.js';
import { cloneCompanyFull, copyCompanyData, copyProfile, COPY_GROUP_KEYS, LEGACY_SCOPE_GROUPS, type CopyGroup } from '../company-copy.js';
import { logActivity } from '../audit.js';
import { confirmSecondFactor, markPasswordChanged, mfaForAll, setSec } from './security.js';
import { addrShape, ADDR_COLS } from '../address.js';
import { purgeTenant } from './pdpa.js';
import { allowedFor, companyTenantOff, modulesOffRaw } from './permissions.js';
import { payrollSource } from './wts.js';
import { createTenantWithAdmin } from './signup.js';
import { emailInvite, maskEmail, maskPhone, noticeCustomer, publicBase } from './provider.js';
import { packagePlan, tenantLimits, TENANT_PACKAGE_FIELDS } from './usage.js';
import { ensureStandardGroups, permissionCompanies } from '../standard-groups.js';
import { applyStarter, lastStarter } from '../starter.js';
import { applyPostingTemplate, companySettings, createFiscalYear, seedChart, seedDocTypes, seedLookups, setSetting } from '../company-template.js';
import { companyAddressAt, saveCurrentAddress } from './company-address.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const uuid = z.string().uuid();
const opt = (n: number) => z.string().trim().max(n).nullable().optional();

export function companyRoutes(app: FastifyInstance, database: Database) {
  const db: Db = database.db;
  /** จำนวนบริษัท/ผู้ใช้สูงสุดที่ใช้จริง (ค่าของลูกค้าทับแพ็กเกจ · HANDOFF 185) — ว่าง = ไม่จำกัด */
  const maxOf = async (tenantId: string, k: 'companies' | 'users') => (await tenantLimits(db, tenantId))?.limits[k] ?? null;

  /* ---------------------------------------------------------------- รายละเอียดกิจการ (บทที่ 5 S-SET-01) */
  app.get('/api/v1/company', async (req) => {
    const a = requireCompany(req);
    const c = await db.selectFrom('sys_company').selectAll().where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const hq = await db.selectFrom('sys_branch').select(['id', 'tax_branch_no', 'name']).where('company_id', '=', a.companyId).where('is_head_office', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
    const s = await companySettings(db, a.companyId);
    // ที่อยู่ที่มีผลวันนี้ (ประวัติที่อยู่ HANDOFF 180) — ย้ายที่อยู่ที่ตั้งวันล่วงหน้าไว้ แสดงเมื่อถึงวัน
    const now = await companyAddressAt(db, a.companyId, todayIso(), null);
    if (now.history_id) Object.assign(c, { address_th: now.address_th, address_en: now.address_en, zip_code: now.zip_code, ...Object.fromEntries(ADDR_COLS.map((k) => [k, now[k] ?? null])) });
    const [addr1, ...addr2] = (c.address_th ?? '').split('\n');
    const [addrEn1, ...addrEn2] = (c.address_en ?? '').split('\n');
    return {
      id: c.id, code: c.code, name_th: c.name_th, name_en: c.name_en, address_th_1: addr1 ?? '', address_th_2: addr2.join(' '), address_en_1: addrEn1 ?? '', address_en_2: addrEn2.join(' '),
      zip_code: c.zip_code, ...Object.fromEntries(ADDR_COLS.map((k) => [k, c[k]])),
      phone: c.phone, tax_id: c.tax_id, trade_reg_no: c.trade_reg_no, social_security_no: c.social_security_no, year_system: c.year_system,
      tax_branch_no: hq?.tax_branch_no ?? '00000', business_type: s['gen.business_type'] ?? 'J', branch_short_name: s['gen.branch_short_name'] ?? '',
      allow_blank_party_tax_id: s['gen.allow_blank_party_tax_id'] ?? true, vat_registered: s['gen.vat_registered'] !== false, vat_rate: s['gen.vat_rate'] ?? 7, account_mask: s['gl.account_mask'] ?? '9999-99',
      voucher_numbering: s['gl.voucher_numbering'] ?? '4', use_department: s['gen.use_department'] ?? true, use_project: s['gen.use_project'] === true, posting_method: s['ic.posting_method'] ?? 'PERIODIC',
    };
  });

  const companyBody = z.object({
    name_th: z.string().trim().min(1, 'ป้อนชื่อบริษัท').max(120), name_en: opt(120),
    address_th_1: opt(120), address_th_2: opt(120), address_en_1: opt(120), address_en_2: opt(120), phone: opt(60),
    zip_code: z.string().trim().regex(/^(\d{5})?$/, 'รหัสไปรษณีย์ 5 หลัก').nullable().optional().transform((v) => v || null), ...addrShape,
    business_type: z.enum(['J', 'P']), tax_id: z.string().trim().min(1, 'ป้อนเลขประจำตัวผู้เสียภาษี'),
    tax_branch_no: z.string().trim().regex(/^\d{1,5}$/, 'สาขา# เป็นตัวเลข (สำนักงานใหญ่ = 0)'),
    branch_short_name: opt(30), allow_blank_party_tax_id: z.boolean(), vat_registered: z.boolean().optional(), trade_reg_no: opt(20), social_security_no: opt(20),
    year_system: z.enum(['B', 'C']), vat_rate: z.coerce.number().min(0).max(100), account_mask: z.string().trim().min(1).max(20),
    voucher_numbering: z.enum(['4', 'M']), use_department: z.boolean(), use_project: z.boolean().optional(),
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
        zip_code: b.zip_code ?? null, ...Object.fromEntries(ADDR_COLS.map((k) => [k, b[k] ?? null])),
        phone: b.phone ?? null, tax_id: tax.normalized, trade_reg_no: b.trade_reg_no ?? null, social_security_no: b.social_security_no ?? null, year_system: b.year_system, updated_by: a.userId,
      }).where('id', '=', a.companyId).execute();
      await tx.updateTable('sys_branch').set({ tax_branch_no: b.tax_branch_no.padStart(5, '0') }).where('company_id', '=', a.companyId).where('is_head_office', '=', true).execute();
      // แก้ที่อยู่ที่หน้านี้ = แก้ที่อยู่ที่มีผลวันนี้ในประวัติที่อยู่ (HANDOFF 180) — ย้ายที่อยู่ใช้ "เพิ่มที่อยู่ใหม่"
      await saveCurrentAddress(tx, a, null, { address_th: join(b.address_th_1, b.address_th_2), address_en: join(b.address_en_1, b.address_en_2), zip_code: b.zip_code ?? null, ...Object.fromEntries(ADDR_COLS.map((k) => [k, b[k] ?? null])) });
      const set = (k: string, v: unknown) => setSetting(tx, a.companyId, k, v, a.userId);
      await set('gen.business_type', b.business_type); await set('gen.branch_short_name', b.branch_short_name ?? '');
      await set('gen.allow_blank_party_tax_id', b.allow_blank_party_tax_id); if (b.vat_registered !== undefined) await set('gen.vat_registered', b.vat_registered); await set('gen.year_system', b.year_system);
      await set('gen.vat_rate', b.vat_rate); await set('gl.account_mask', b.account_mask); await set('gl.voucher_numbering', b.voucher_numbering);
      await set('gen.use_department', b.use_department);
      if (b.use_project !== undefined) await set('gen.use_project', b.use_project);
      await logActivity(tx, a, { module: 'SYS', action: 'EDIT', table: 'sys_company', rowId: a.companyId });
    });
    return { ok: true, warning: tax.kind === 'LEGACY10' ? tax.warning : undefined };
  });

  /** ธีมของบริษัท (ข้อกำหนดเจ้าของ 30/10/2569) — เลือกจากชุดสีพาสเทลและแบบอักษรที่กำหนดเท่านั้น · ทุกคนในบริษัทเห็นเหมือนกัน */
  app.put('/api/v1/company/ui-theme', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ theme: z.string().max(20), font: z.string().max(20) }), req.body);
    const v = normalizeUiTheme(b);
    if (v.theme !== b.theme || v.font !== b.font) throw badRequest('เลือกธีมและแบบอักษรจากรายการ');
    await setSetting(db, a.companyId, 'ui.theme', v, a.userId);
    await logActivity(db, a, { module: 'SYS', action: 'SET_THEME', table: 'sys_company', rowId: a.companyId, detail: v });
    return v;
  });

  /** ระบบที่ใช้งาน (ข้อกำหนดเจ้าของ 30/10/2569: ปิดบางระบบทั้งบริษัท) — ปิด = ซ่อนเมนูและ API ปฏิเสธ ข้อมูลเดิมไม่หาย */
  app.get('/api/v1/company/modules', async (req) => {
    const a = requireCompany(req);
    return { off: await modulesOffRaw(db, a.companyId), modules: MODULE_SWITCHES, payroll_source: await payrollSource(db, a.companyId) };
  });
  app.put('/api/v1/company/modules', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ off: z.array(z.string().max(20)).max(50) }), req.body);
    const bad = b.off.filter((k) => !MODULE_SWITCHES.some((m) => m.key === k));
    if (bad.length) throw badRequest(`ไม่รู้จักระบบ ${bad.join(', ')}`);
    const off = MODULE_SWITCHES.map((m) => m.key).filter((k) => b.off.includes(k));
    const before = await modulesOffRaw(db, a.companyId);
    await setSetting(db, a.companyId, 'sys.modules_off', off, a.userId);
    await logActivity(db, a, { module: 'SYS', action: 'SET_MODULES', table: 'sys_company', rowId: a.companyId, detail: { before, after: off } });
    return { off };
  });

  /* ---------------------------------------------------------------- ลบ/กู้คืนบริษัท (HANDOFF 175 — เจ้าของ 23/11/2569 "กรณีสร้างบริษัทผิด หรือต้องการลบบริษัทที่ไม่ใช้แล้ว … (Admin เท่านั้นที่ทำได้)") */
  /**
   * ผู้ดูแลระบบของลูกค้า (บริษัทของลูกค้าตัวเอง) หรือเจ้าหน้าที่ผู้ให้บริการเท่านั้น · ลบ = ตั้ง deleted_at ของบริษัทและสิทธิ์ผู้ใช้ในบริษัทนั้น (ไม่ลบข้อมูลจริง)
   * หายจากรายการเลือกบริษัทและจำนวนบริษัทของลูกค้า · กู้คืนได้จากรายการ "บริษัทที่ลบแล้ว" · บันทึก sys_activity_log ทั้งลบและกู้คืน
   */
  /**
   * HANDOFF 201: เมนู บริษัททั้งหมด / ลบบริษัท (SET.COS · ADMIN_MENUS) — ผู้ดูแลระบบของลูกค้า/เจ้าหน้าที่ผู้ให้บริการ และตรวจด้วย decide() ตัวเดียวกับเมนู
   * (สิทธิ์รวม ALL/เริ่มระบบ/รายละเอียดกิจการ/ระดับ 9 ไม่ให้เมนูนี้) · action = การทำงานของปุ่ม
   */
  const manager = async (req: Parameters<typeof requireAuth>[0], action: 'read' | 'add' | 'edit' | 'delete' = 'read') => {
    const a = requireAuth(req);
    if (!a.isPlatform && !(a.isAdmin && a.tenantId)) throw forbidden('เฉพาะผู้ดูแลระบบของลูกค้า หรือเจ้าหน้าที่ผู้ให้บริการ ลบ/กู้คืนบริษัทได้');
    if (a.companyId && !(await allowedFor(db, a, 'SET.COS', action)).allowed) throw forbidden('เมนู บริษัททั้งหมด / ลบบริษัท เฉพาะผู้ดูแลระบบของกิจการ (กลุ่ม ADMIN)');
    return a;
  };
  const companyOf = async (a: AuthContext, id: string) => {
    const c = await db.selectFrom('sys_company').select(['id', 'code', 'name_th', 'tenant_id', 'deleted_at']).where('id', '=', id).executeTakeFirst();
    // ข้ามลูกค้าไม่ได้ (ข้อ 7.1): บริษัทของลูกค้าอื่น = ไม่พบ
    if (!c || (!a.isPlatform && c.tenant_id !== a.tenantId)) throw notFound('บริษัท');
    // HANDOFF 204: ผู้ให้บริการแก้รหัส/คัดลอก/ลบ/กู้คืนได้เฉพาะบริษัทของลูกค้าข้อมูลตัวอย่าง (ลูกค้าจริง = ผู้ดูแลของลูกค้าทำเอง)
    await requireDemoForProvider(db, a, c.tenant_id);
    return c;
  };
  app.get('/api/v1/companies/manage', async (req) => {
    const a = await manager(req);
    const rows = (await sql<{ id: string; code: string; name_th: string; tenant_code: string | null; deleted_at: string | null; deleted_by: string | null; doc_count: number; journal_count: number; last_date: string | null; next_start: string | null }>`
      SELECT c.id, c.code, c.name_th, t.code AS tenant_code, c.deleted_at::text AS deleted_at, u.display_name AS deleted_by,
             -- เปิดแฟ้มข้อมูลใหม่: วันเริ่มปีบัญชีที่แนะนำ = วันถัดจากสิ้นปีบัญชีที่ทำงานอยู่ (ปีที่เริ่มแล้วล่าสุด)
             (SELECT to_char(y.end_date + 1, 'YYYY-MM-DD') FROM gl_fiscal_year y WHERE y.company_id = c.id AND y.deleted_at IS NULL AND y.start_date <= current_date ORDER BY y.start_date DESC LIMIT 1) AS next_start,
             (SELECT count(*)::int FROM doc_header h WHERE h.company_id = c.id AND h.deleted_at IS NULL) AS doc_count,
             (SELECT count(*)::int FROM gl_journal j WHERE j.company_id = c.id AND j.deleted_at IS NULL) AS journal_count,
             to_char(greatest((SELECT max(h.doc_date) FROM doc_header h WHERE h.company_id = c.id AND h.deleted_at IS NULL),
                              (SELECT max(j.voucher_date) FROM gl_journal j WHERE j.company_id = c.id AND j.deleted_at IS NULL)), 'YYYY-MM-DD') AS last_date
        FROM sys_company c LEFT JOIN sys_tenant t ON t.id = c.tenant_id LEFT JOIN sys_user u ON u.id = c.updated_by AND c.deleted_at IS NOT NULL
       WHERE ${a.isPlatform ? sql`t.is_demo` : sql`c.tenant_id = ${a.tenantId}`}
       ORDER BY c.deleted_at NULLS FIRST, c.code LIMIT 1000`.execute(db)).rows;
    return { rows: rows.map((r) => ({ ...r, current: r.id === a.companyId })) };
  });
  /**
   * แก้รหัสบริษัท (HANDOFF 181 ข้อ 1) — ผู้ดูแลระบบของลูกค้า/เจ้าหน้าที่ผู้ให้บริการ · รูปแบบเดียวกับตอนสร้าง · ไม่ซ้ำกับบริษัทที่ใช้งานอยู่
   * ระบบอ้างบริษัทด้วยรหัสแถว (id) ทุกที่ (การเชื่อม POS/Living กุญแจ API แฟ้มสำรอง e-Tax เครื่องสาขา) — รหัสบริษัทใช้แสดงและตั้งชื่อแฟ้มเท่านั้น
   */
  app.put('/api/v1/companies/:id/code', async (req) => {
    const a = await manager(req, 'edit');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ code: codeRule }), req.body);
    const c = await companyOf(a, id);
    if (c.deleted_at) throw badRequest(`บริษัท ${c.code} ถูกลบไปแล้ว — กู้คืนก่อนจึงแก้รหัสได้`);
    if (b.code === c.code) return { ok: true, code: c.code };
    const dup = await db.selectFrom('sys_company').select('id').where('code', '=', b.code).where('deleted_at', 'is', null).where('id', '<>', id).executeTakeFirst();
    if (dup) throw badRequest(`รหัสบริษัท ${b.code} มีอยู่แล้ว — เลือกรหัสอื่น`, [{ field: 'code', message: 'รหัสซ้ำ' }]);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_company').set({ code: b.code, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, { companyId: id, userId: a.userId }, { module: 'SYS', action: 'EDIT_CODE', docNo: b.code, table: 'sys_company', rowId: id, detail: { before: c.code, after: b.code } });
    });
    return { ok: true, code: b.code };
  });

  /**
   * คัดลอกบริษัท (HANDOFF 181 ข้อ 2) — บริษัทเดิมไม่ถูกแก้/ลบ · บริษัทใหม่อยู่กับลูกค้ารายเดียวกับบริษัทเดิม
   * mode full = ทั้งหมด (ตรวจจำนวนแถว/ใบสำคัญ/เดบิต/เครดิตเท่าเดิม ไม่เท่า = ยกเลิก) · new = เปิดแฟ้มข้อมูลใหม่ (ค่าตั้งระบบ + ข้อมูลหลักที่เลือก + ปีบัญชีใหม่)
   */
  app.post('/api/v1/companies/:id/copy', async (req) => {
    const a = await manager(req, 'add');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({
      code: codeRule, name_th: z.string().trim().min(1, 'ป้อนชื่อบริษัท').max(120), mode: z.enum(['full', 'new']),
      groups: z.array(z.enum(COPY_GROUP_KEYS as [CopyGroup, ...CopyGroup[]])).default([]), fiscal_start: isoDate.optional(),
    }), req.body);
    const c = await companyOf(a, id);
    if (c.deleted_at) throw badRequest(`บริษัท ${c.code} ถูกลบไปแล้ว — กู้คืนก่อนจึงคัดลอกได้`);
    const r = await createCompany(a, { code: b.code, name_th: b.name_th, chart: 'copy', copy_from_company_id: id, copy_scope: b.mode, copy_groups: b.groups, fiscal_start: b.fiscal_start, tenantId: c.tenant_id, starter: 'BLANK' });
    return { id: r.id, code: b.code, copied: r.copied, check: r.check, seconds: r.seconds };
  });

  app.post('/api/v1/companies/:id/delete', async (req) => {
    const a = await manager(req, 'delete');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ confirm_code: z.string().trim().min(1, 'พิมพ์รหัสบริษัทเพื่อยืนยัน'), totp_code: z.string().trim().max(20).nullable().optional() }), req.body);
    const c = await companyOf(a, id);
    if (c.deleted_at) throw badRequest(`บริษัท ${c.code} ถูกลบไปแล้ว`);
    if (b.confirm_code.toUpperCase() !== c.code.toUpperCase()) throw badRequest(`พิมพ์รหัสบริษัท "${c.code}" ให้ตรงเพื่อยืนยันการลบ`, [{ field: 'confirm_code', message: 'ไม่ตรง' }]);
    if (a.companyId === id) throw badRequest(`บริษัท ${c.code} กำลังใช้งานอยู่ในหน้านี้ — เปลี่ยนไปบริษัทอื่นที่ตัวเลือกบริษัทด้านบนก่อน แล้วจึงลบ`);
    const left = await db.selectFrom('sys_company').select(sql<number>`count(*)::int`.as('n')).where('tenant_id', '=', c.tenant_id).where('deleted_at', 'is', null).where('id', '<>', id).executeTakeFirstOrThrow();
    if (Number(left.n) < 1) throw badRequest('ลบบริษัทสุดท้ายของลูกค้าไม่ได้ — ต้องมีบริษัทที่ใช้งานอย่างน้อย 1 บริษัท');
    await confirmSecondFactor(db, a.userId, b.totp_code);
    const info = (await sql<{ docs: number; last_date: string | null }>`SELECT (SELECT count(*)::int FROM doc_header WHERE company_id = ${id} AND deleted_at IS NULL) + (SELECT count(*)::int FROM gl_journal WHERE company_id = ${id} AND deleted_at IS NULL) AS docs,
        to_char(greatest((SELECT max(doc_date) FROM doc_header WHERE company_id = ${id} AND deleted_at IS NULL), (SELECT max(voucher_date) FROM gl_journal WHERE company_id = ${id} AND deleted_at IS NULL)), 'YYYY-MM-DD') AS last_date`.execute(db)).rows[0]!;
    const ts = new Date().toISOString();
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_company').set({ deleted_at: ts as never, updated_by: a.userId }).where('id', '=', id).execute();
      await tx.updateTable('sys_user_company').set({ deleted_at: ts as never, updated_by: a.userId }).where('company_id', '=', id).where('deleted_at', 'is', null).execute();
      await logActivity(tx, { companyId: id, userId: a.userId }, { module: 'SYS', action: 'DELETE_COMPANY', docNo: c.code, table: 'sys_company', rowId: id, detail: { name: c.name_th, docs: info.docs, last_date: info.last_date, tenant_id: c.tenant_id } });
    });
    return { ok: true, code: c.code };
  });
  app.post('/api/v1/companies/:id/restore', async (req) => {
    const a = await manager(req, 'edit');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await companyOf(a, id);
    if (!c.deleted_at) throw badRequest(`บริษัท ${c.code} ยังใช้งานอยู่`);
    const dup = await db.selectFrom('sys_company').select('id').where('code', '=', c.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup) throw badRequest(`มีบริษัทรหัส ${c.code} ที่ใช้งานอยู่แล้ว — กู้คืนไม่ได้จนกว่าจะเปลี่ยนรหัสบริษัทนั้น`);
    const maxCo = c.tenant_id ? await maxOf(c.tenant_id, 'companies') : null;
    if (maxCo != null) {
      const n = await db.selectFrom('sys_company').select(sql<number>`count(*)::int`.as('n')).where('tenant_id', '=', c.tenant_id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(n.n) >= maxCo) throw badRequest(`แพ็กเกจนี้มีบริษัทได้สูงสุด ${maxCo} บริษัท — ลบบริษัทอื่นก่อน หรือติดต่อผู้ให้บริการ`);
    }
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_company').set({ deleted_at: null, updated_by: a.userId }).where('id', '=', id).execute();
      // สิทธิ์ผู้ใช้ที่ถูกลบพร้อมบริษัท (เวลาเดียวกัน) กลับมา
      await tx.updateTable('sys_user_company').set({ deleted_at: null, updated_by: a.userId }).where('company_id', '=', id).where('deleted_at', '=', c.deleted_at as never).execute();
      await logActivity(tx, { companyId: id, userId: a.userId }, { module: 'SYS', action: 'RESTORE_COMPANY', docNo: c.code, table: 'sys_company', rowId: id, detail: { name: c.name_th, deleted_at: c.deleted_at } });
    });
    return { ok: true, code: c.code };
  });

  /* ---------------------------------------------------------------- กำหนดบริษัทใหม่ (บทที่ 4 S-CO-03 / S-CO-07) */
  const codeRule = z.string().trim().min(1, 'ป้อนรหัสบริษัท').max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสบริษัทใช้ตัวอักษรอังกฤษ ตัวเลข _ -');
  type NewCompany = {
    code: string; name_th: string; tax_id?: string; fiscal_start?: string; chart: 'express' | 'th_en' | 'copy' | 'none'; copy_from_company_id?: string;
    copy_scope: 'chart' | 'setup' | 'all' | 'new' | 'full'; copy_groups?: CopyGroup[]; tenantId: string; starter: 'TRADE' | 'SERVICE' | 'MFG' | 'BLANK';
  };
  /**
   * สร้างบริษัทใหม่ (S-CO-03) — ทางเดียวทั้ง "กำหนดบริษัทใหม่" และ "คัดลอกบริษัท" (HANDOFF 181)
   * copy_scope: chart = เฉพาะผังบัญชี · new (เปิดแฟ้มข้อมูลใหม่) = ค่าตั้งระบบ + ข้อมูลหลักตาม copy_groups · full = ทั้งหมดรวมเอกสาร/ใบสำคัญ/ยอดยกมา (ตรวจยอดเท่าเดิม ไม่เท่า = ยกเลิก)
   * setup/all = ชื่อเดิมของ new (setup = + บัญชีเงินฝาก · all = + ลูกค้า ผู้จำหน่าย พนักงานขาย สินค้า)
   */
  async function createCompany(a: AuthContext, b: NewCompany) {
    const tenantId = b.tenantId;
    await requireDemoForProvider(db, a, tenantId);   // HANDOFF 204 ข้อ d6
    if (!(b.chart === 'copy' && b.copy_scope === 'full') && !b.fiscal_start) throw badRequest('ป้อนวันเริ่มรอบบัญชี', [{ field: 'fiscal_start', message: 'ป้อนวันที่' }]);
    const t = await db.selectFrom('sys_tenant').select(['id', 'max_companies', 'status']).where('id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw badRequest('ไม่พบลูกค้าผู้ใช้บริการ');
    const maxCo = await maxOf(tenantId, 'companies');
    if (maxCo !== null) {
      const n = await db.selectFrom('sys_company').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(n.n) >= maxCo) throw badRequest(`แพ็กเกจนี้สร้างบริษัทได้สูงสุด ${maxCo} บริษัท`);
    }
    if (b.copy_from_company_id && !(await canAccessCompany(db, a, b.copy_from_company_id))) throw forbidden('ไม่มีสิทธิ์คัดลอกจากบริษัทนี้');
    const exists = await db.selectFrom('sys_company').select('id').where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (exists) throw badRequest(`รหัสบริษัท ${b.code} มีอยู่แล้ว`);
    let taxId: string | null = null;
    if (b.tax_id) { const tx = checkTaxId(b.tax_id); if (!tx.ok) throw badRequest(tx.error); taxId = tx.normalized; }
    const copying = b.chart === 'copy';
    if (copying && !b.copy_from_company_id) throw badRequest('เลือกบริษัทต้นแบบที่จะคัดลอก');
    const full = copying && b.copy_scope === 'full';
    const groups: CopyGroup[] = b.copy_scope === 'setup' || b.copy_scope === 'all' ? LEGACY_SCOPE_GROUPS[b.copy_scope] : b.copy_groups ?? [];
    const started = Date.now();
    const r = await db.transaction().execute(async (tx) => {
      const c = await tx.insertInto('sys_company').values({ tenant_id: tenantId, code: b.code, name_th: b.name_th, tax_id: taxId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      let copied: Record<string, number> | null = null;
      let check: Awaited<ReturnType<typeof cloneCompanyFull>> | null = null;
      if (full) {
        // คัดลอกทั้งหมด: สาขา ปีบัญชี/งวด เอกสาร ใบสำคัญ ยอดยกมา ทรัพย์สิน รูป แบบฟอร์ม … ของบริษัทเดิม (id ใหม่) — ไม่สร้างสาขา/ปีบัญชีใหม่
        await copyProfile(tx, b.copy_from_company_id!, c.id);
        check = await cloneCompanyFull(tx, b.copy_from_company_id!, c.id);
        if (!check.ok) throw new AppError(409, 'COPY_CHECK_FAILED', `คัดลอกแล้วข้อมูลไม่ตรงกับบริษัทเดิม (${[...check.diff.slice(0, 3), check.totals.source.j !== check.totals.copy.j ? `ใบสำคัญ ${check.totals.source.j}→${check.totals.copy.j}` : '', !d(check.totals.source.dr).eq(check.totals.copy.dr) ? `เดบิต ${check.totals.source.dr}→${check.totals.copy.dr}` : ''].filter(Boolean).join(', ')}) — ยกเลิกแล้ว ไม่มีอะไรถูกสร้าง`);
      } else {
        await tx.insertInto('sys_branch').values({ company_id: c.id, code: '00000', name: 'สำนักงานใหญ่', tax_branch_no: '00000', is_head_office: true, created_by: a.userId }).execute();
        await createFiscalYear(tx, c.id, b.fiscal_start!, a.userId);
        if (copying && b.copy_scope !== 'chart') {
          await copyProfile(tx, b.copy_from_company_id!, c.id);
          copied = await copyCompanyData(tx, b.copy_from_company_id!, c.id, a.userId, groups, { newStart: b.fiscal_start });
          if (!copied.gl_account) throw new AppError(400, 'EMPTY_CHART', 'บริษัทต้นแบบไม่มีผังบัญชี');
        } else {
          await seedChart(tx, c.id, { chart: b.chart === 'express' || b.chart === 'th_en' ? b.chart : null });
          await seedDocTypes(tx, c.id);
          await seedLookups(tx, c.id);
          if (copying) await copyChart(tx, b.copy_from_company_id!, c.id);
          // ข้อมูลตั้งต้นตามประเภทธุรกิจ (HANDOFF 160) — ผังมาตรฐานเท่านั้น (คัดลอกจากบริษัทอื่น = ใช้ข้อมูลของบริษัทต้นแบบ)
          if (!copying && b.starter !== 'BLANK') {
            const st = await applyStarter(tx, c.id, b.starter, a.userId);
            await logActivity(tx, { companyId: c.id, userId: a.userId }, { module: 'SYS', action: 'STARTER_DATA', table: 'sys_company', rowId: c.id, detail: { template: st.template, added: st.added } });
          }
        }
      }
      // บริษัทที่สอง ฯลฯ: กลุ่มตั้งต้นที่ลูกค้ามีอยู่ได้สิทธิ์ในบริษัทใหม่ด้วย (ไม่สร้างกลุ่มใหม่ ไม่แตะสิทธิ์ที่แก้เอง)
      await ensureStandardGroups(tx, tenantId, a.userId, { createGroups: false, companyIds: [c.id] });
      await logActivity(tx, { companyId: c.id, userId: a.userId }, { module: 'SYS', action: copying && b.copy_scope !== 'chart' ? 'COPY_COMPANY' : 'NEW_COMPANY', table: 'sys_company', rowId: c.id,
        detail: { code: b.code, tenant_id: tenantId, copied_from: b.copy_from_company_id ?? null, scope: copying ? b.copy_scope : null, groups: copying && !full ? groups : undefined, copied, check: check ? { tables: check.tables, rows: check.rows, totals: check.totals } : undefined } });
      return { id: c.id, copied, check };
    });
    await applyPostingTemplate(database.execScript, r.id);
    return { ...r, seconds: Math.round((Date.now() - started) / 100) / 10 };
  }

  app.post('/api/v1/companies', async (req) => {
    const a = requireAuth(req);
    if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบสร้างบริษัทใหม่ได้');
    const b = parse(z.object({
      code: codeRule,
      name_th: z.string().trim().min(1, 'ป้อนชื่อบริษัท').max(120), tax_id: z.string().trim().optional(),
      fiscal_start: isoDate.optional(), chart: z.enum(['express', 'th_en', 'copy', 'none']).default('express'), copy_from_company_id: uuid.optional(),
      /** คัดลอกจากบริษัทต้นแบบ: chart = เฉพาะผังบัญชี · new = เปิดแฟ้มข้อมูลใหม่ (copy_groups) · full = ทั้งหมด · setup/all = แบบเดิม */
      copy_scope: z.enum(['chart', 'setup', 'all', 'new', 'full']).default('chart'), copy_groups: z.array(z.enum(COPY_GROUP_KEYS as [CopyGroup, ...CopyGroup[]])).optional(),
      tenant_id: uuid.optional(),
      /** ประเภทธุรกิจ: ข้อมูลตั้งต้น (HANDOFF 160) · ไม่ส่ง = ว่าง (แบบเดิม) */
      starter: z.enum(['TRADE', 'SERVICE', 'MFG', 'BLANK']).default('BLANK'),
    }), req.body);
    // ผู้ดูแลของลูกค้าสร้างได้เฉพาะใน tenant ตัวเอง; ผู้ให้บริการเลือก tenant ได้ (ไม่ระบุ = ลูกค้าเริ่มต้น)
    const tenantId = a.isPlatform ? (b.tenant_id ?? (await defaultTenant(db))) : a.tenantId!;
    const r = await createCompany(a, { ...b, tenantId });
    return { id: r.id, copied: r.copied, check: r.check, seconds: r.seconds };
  });

  /* ---------------------------------------------------------------- ข้อมูลตั้งต้นตามประเภทธุรกิจ (HANDOFF 160) */
  // บริษัทที่มีอยู่แล้ว (เช่น สร้างก่อนมีต้นแบบ): ดูก่อนว่าจะเพิ่มอะไร แล้วเติมเฉพาะรหัสที่ยังไม่มี — ไม่แก้สิ่งที่ลูกค้าตั้งเอง
  const starterKey = z.object({ template: z.enum(['TRADE', 'SERVICE', 'MFG']) });
  app.get('/api/v1/company/starter-data', async (req) => {
    const a = requireCompany(req);
    const q = req.query as { template?: string };
    const last = await lastStarter(db, a.companyId);
    const template = (q.template ? parse(starterKey, q).template : (last && last !== 'BLANK' ? last : 'TRADE'));
    return { last, preview: await applyStarter(db, a.companyId, template, a.userId, true) };
  });
  app.post('/api/v1/company/starter-data', async (req) => {
    const a = requireCompany(req);
    const { template } = parse(starterKey, req.body);
    const r = await applyStarter(db, a.companyId, template, a.userId);
    await logActivity(db, a, { module: 'SYS', action: 'STARTER_DATA', table: 'sys_company', rowId: a.companyId, detail: { template, added: r.added, manual: true } });
    return r;
  });

  /* ---------------------------------------------------------------- สาขา */
  app.get('/api/v1/branches', async (req) => {
    const a = requireCompany(req);
    const rows = await db.selectFrom('sys_branch').select(['id', 'code', 'name', 'tax_branch_no', 'address', 'zip_code', ...ADDR_COLS, 'is_head_office', 'status']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute();
    // สาขาสำนักงานใหญ่ = ที่อยู่ของกิจการที่มีผลวันนี้ (รายละเอียดกิจการ · HANDOFF 194) — ช่องที่อยู่ในแฟ้มสาขาสำนักงานใหญ่ไม่ได้ใช้พิมพ์
    if (!rows.some((r) => r.is_head_office)) return rows;
    const ho = await companyAddressAt(db, a.companyId, null, null);
    const text = [ho.address_th.replace(/\s*\n\s*/g, ' ').trim(), ho.zip_code && !ho.address_th.includes(ho.zip_code) ? ho.zip_code : ''].filter(Boolean).join(' ');
    return rows.map((r) => (r.is_head_office ? { ...r, company_address: text, company_address_from: ho.effective_from } : r));
  });
  const branchBody = z.object({ code: z.string().trim().min(1, 'ป้อนรหัสสาขา').max(10), name: z.string().trim().min(1, 'ป้อนชื่อสาขา').max(120), tax_branch_no: z.string().trim().regex(/^\d{5}$/, 'เลขที่สาขา 5 หลัก เช่น 00001'), address: z.string().max(500).nullable().optional(),
    zip_code: z.string().trim().regex(/^(\d{5})?$/, 'รหัสไปรษณีย์ 5 หลัก').nullable().optional().transform((v) => v || null), ...addrShape, status: z.enum(['A', 'I']).default('A') });
  app.post('/api/v1/branches', async (req) => {
    const a = requireCompany(req);
    const b = parse(branchBody, req.body);
    const r = await db.insertInto('sys_branch').values({ ...b, address: b.address ?? null, company_id: a.companyId, is_head_office: false, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SYS', action: 'ADD', docNo: b.code, table: 'sys_branch', rowId: r.id });
    await saveCurrentAddress(db, a, r.id, { address_th: b.address ?? null, address_en: null, zip_code: b.zip_code ?? null, ...Object.fromEntries(ADDR_COLS.map((k) => [k, b[k] ?? null])) });
    return r;
  });
  app.put('/api/v1/branches/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(branchBody, req.body);
    const cur = await db.selectFrom('sys_branch').select('is_head_office').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('สาขา');
    const hq = cur.is_head_office;
    // สาขาสำนักงานใหญ่: ที่อยู่มาจากรายละเอียดกิจการ (HANDOFF 194) — บันทึกเฉพาะรหัส ชื่อ เลขที่สาขา สถานะ ไม่แตะช่องที่อยู่
    const set = hq ? { code: b.code, name: b.name, tax_branch_no: b.tax_branch_no, status: b.status } : { ...b, address: b.address ?? null };
    await db.updateTable('sys_branch').set({ ...set, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).execute();
    await logActivity(db, a, { module: 'SYS', action: 'EDIT', docNo: b.code, table: 'sys_branch', rowId: id });
    // ที่อยู่สาขา = แถวที่มีผลวันนี้ในประวัติที่อยู่ (HANDOFF 180) · สาขาสำนักงานใหญ่ใช้ที่อยู่ของบริษัท
    if (!hq) await saveCurrentAddress(db, a, id, { address_th: b.address ?? null, address_en: null, zip_code: b.zip_code ?? null, ...Object.fromEntries(ADDR_COLS.map((k) => [k, b[k] ?? null])) });
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
    let uq = db.selectFrom('sys_user as u').leftJoin('sys_user_group as g', (j) => j.onRef('g.id', '=', 'u.user_group_id').on('g.deleted_at', 'is', null)).leftJoin('sys_tenant as t', 't.id', 'u.tenant_id')
      .select(['u.id', 'u.username', 'u.display_name', 'u.status', 'u.approval_level', 'u.check_rights', 'u.single_session', 'u.app_access', 'u.last_login_at', 'u.user_group_id', 'u.tenant_id', 't.code as tenant_code', 'g.code as group_code', 'g.name as group_name',
        sql<boolean>`u.password_hash IS NOT NULL`.as('has_password')])
      .where('u.deleted_at', 'is', null);
    let gq = db.selectFrom('sys_user_group as g').leftJoin('sys_tenant as t', 't.id', 'g.tenant_id').select(['g.id', 'g.code', 'g.name', 'g.tenant_id', 't.code as tenant_code']).where('g.deleted_at', 'is', null);
    if (!a.isPlatform) { uq = uq.where('u.tenant_id', '=', a.tenantId!); gq = gq.where('g.tenant_id', '=', a.tenantId!); }
    // ?for=company: เฉพาะผู้ใช้/กลุ่มของลูกค้าเจ้าของบริษัทที่เลือกอยู่ — หน้าสิทธิ์รายเมนู (HANDOFF 191 · ผู้ให้บริการก็เห็นเฉพาะลูกค้ารายนี้)
    const { for: forScope } = parse(z.object({ for: z.enum(['company']).optional() }), req.query ?? {});
    if (forScope === 'company') {
      if (!a.companyId) throw badRequest('ยังไม่ได้เลือกบริษัท — เลือกบริษัทก่อนกำหนดสิทธิ์รายเมนู');
      const ct = (await db.selectFrom('sys_company').select('tenant_id').where('id', '=', a.companyId).executeTakeFirst())?.tenant_id ?? null;
      uq = ct ? uq.where('u.tenant_id', '=', ct) : uq.where('u.tenant_id', 'is', null);
      gq = ct ? gq.where('g.tenant_id', '=', ct) : gq.where('g.tenant_id', 'is', null);
    }
    const users = await uq.orderBy('u.username').execute();
    // ยืนยันตัวตนสองขั้น / ล็อก (T0.16)
    const secs = users.length ? await db.selectFrom('sys_user_security').select(['user_id', 'totp_enabled', 'locked_until']).where('user_id', 'in', users.map((u) => u.id)).where('deleted_at', 'is', null).execute() : [];
    const links = users.length ? await db.selectFrom('sys_user_company').select(['user_id', 'company_id']).where('user_id', 'in', users.map((u) => u.id)).where('deleted_at', 'is', null).execute() : [];
    const groups = await gq.orderBy('t.code').orderBy('g.code').execute();
    // บริษัทที่ผู้ใช้/กลุ่มมีแถวสิทธิ์รายเมนู — หน้าจอเตือนเมื่อ "ตรวจสอบสิทธิ์ก่อนใช้งาน" แต่ไม่มีสิทธิ์ในบริษัทที่เลือก (HANDOFF 159)
    const rowsIn = await permissionCompanies(db, [...users.map((u) => u.id), ...groups.map((g) => g.id)]);
    // ลิงก์เชิญที่ยังใช้ได้ (HANDOFF 184) — แสดงสถานะ "รอตั้งรหัสผ่าน ถึง …"
    // กุญแจ API ที่ใช้งานอยู่ของผู้ใช้ (HANDOFF 198 ตรวจทาน — แสดงว่ากุญแจได้สิทธิ์แบบไหน)
    // กุญแจ API = เมนูผู้ให้บริการ (HANDOFF 199) — ผู้ดูแลของลูกค้าไม่เห็นจำนวนกุญแจ
    const keyCount = new Map((users.length && a.isPlatform ? await db.selectFrom('sys_api_key').select(['user_id', sql<number>`count(*)::int`.as('n')]).where('user_id', 'in', users.map((u) => u.id))
      .where('status', '=', 'A').where('deleted_at', 'is', null).groupBy('user_id').execute() : []).map((r) => [r.user_id, Number(r.n)]));
    const invites = users.length ? await db.selectFrom('sys_user_invite').select(['user_id', 'expires_at']).where('user_id', 'in', users.map((u) => u.id))
      .where('used_at', 'is', null).where('revoked_at', 'is', null).where('deleted_at', 'is', null).where('expires_at', '>', sql<string>`now()`).execute() : [];
    // สิทธิ์ของแต่ละกลุ่มในบริษัทที่เลือกอยู่ — หน้าเพิ่มผู้ใช้สรุปว่ากลุ่มทำอะไรได้ (HANDOFF 197) · ช่องว่าง = ''
    const gRights = a.companyId && groups.length ? await db.selectFrom('sys_permission as p').innerJoin('sys_menu as m', 'm.id', 'p.menu_id')
      .select(['p.subject_id', 'm.code as menu', 'p.can_read', 'p.can_add', 'p.can_edit', 'p.can_cancel', 'p.can_delete', 'p.can_print', 'p.can_approve'])
      .where('p.company_id', '=', a.companyId).where('p.subject_type', '=', 'G').where('p.subject_id', 'in', groups.map((g) => g.id)).where('p.deleted_at', 'is', null)
      .where('m.code', 'not in', [...PLATFORM_MENUS, ...Object.keys(ADMIN_MENUS), ...(await companyTenantOff(db, a.companyId))]).execute() : [];   // เมนูผู้ให้บริการ (HANDOFF 199) + ที่ลูกค้ายังไม่ได้เปิด (HANDOFF 200) ไม่อยู่ในสรุปสิทธิ์
    const cell = (v: string | null) => (v ?? '').trim();
    return { users: users.map((u) => { const sc = secs.find((x) => x.user_id === u.id); return { ...u, app_access: normalizeAppAccess(u.app_access), companies: links.filter((l) => l.user_id === u.id).map((l) => l.company_id), rights_in: rowsIn.get(u.id) ?? [], mfa_enabled: !!sc?.totp_enabled, locked_until: sc?.locked_until && new Date(sc.locked_until).getTime() > Date.now() ? sc.locked_until : null,
      invite_expires_at: invites.find((x) => x.user_id === u.id)?.expires_at ?? null, api_keys: keyCount.get(u.id) ?? 0 }; }),
      groups: groups.map((g) => ({ ...g, rights_in: rowsIn.get(g.id) ?? [],
        rights: gRights.filter((r) => r.subject_id === g.id).map((r) => ({ menu: r.menu, can_read: cell(r.can_read), can_add: cell(r.can_add), can_edit: cell(r.can_edit), can_cancel: cell(r.can_cancel), can_delete: cell(r.can_delete), can_print: cell(r.can_print), can_approve: cell(r.can_approve) })) })),
      mfa_all: mfaForAll() };
  });
  /** ค่าที่เก็บใน sys_user.app_access (jsonb): null = ทุกโปรแกรมของลูกค้า · รายการเรียงตาม TENANT_MODULES ไม่ซ้ำ */
  const appAccessValue = (v: string[] | null | undefined) => { const n = normalizeAppAccess(v ?? null); return n === null ? null : (JSON.stringify(n) as never); };
  const userBody = z.object({
    username: z.string().trim().min(1, 'ป้อนรหัสผู้ใช้').max(30).regex(/^[A-Za-z0-9_.@-]+$/, 'รหัสผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . @ -'),
    display_name: z.string().trim().min(1, 'ป้อนชื่อผู้ใช้').max(120), password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })).optional(),
    user_group_id: uuid.nullable().optional(), approval_level: z.coerce.number().int().min(0).max(9).default(0), check_rights: z.boolean().default(false), status: z.enum(['A', 'I']).default('A'),
    companies: z.array(uuid).default([]), tenant_id: uuid.nullable().optional(),
    // 1 รหัสเข้าได้ทีละ 1 เครื่อง เฉพาะผู้ใช้นี้ (HANDOFF 156) · ไม่ส่ง = คงค่าเดิม
    single_session: z.boolean().optional(),
    // เพิ่มผู้ใช้โดยไม่ตั้งรหัสผ่าน แล้วสร้างลิงก์เชิญให้ตั้งเอง (HANDOFF 184)
    invite: z.boolean().optional(),
    // โปรแกรมที่เปิดได้จาก Hub (09/11/2569): null = ทุกโปรแกรมของลูกค้า · [...] = เฉพาะที่ระบุ · ไม่ส่ง (หน้าจอรุ่นเก่า) = คงค่าเดิม
    app_access: z.array(z.string().refine(isTenantModuleKey, (k) => ({ message: `ไม่รู้จักโปรแกรม "${k}" — ใช้ได้: ${TENANT_MODULES.map((m) => m.key).join(' ')}` }))).max(TENANT_MODULES.length).nullable().optional(),
  });
  const NO_COMPANY = 'ยังไม่ได้เลือกบริษัทที่เข้าได้ — ผู้ใช้นี้จะเข้าบริษัทใดไม่ได้ ติ๊กบริษัทอย่างน้อย 1 บริษัท (หรือเลือกกลุ่ม ADMIN ซึ่งเข้าได้ทุกบริษัท)';
  /** ตรวจว่ากลุ่มและบริษัทที่กำหนดให้ผู้ใช้อยู่ใน tenant เดียวกับผู้ใช้ — กันการให้สิทธิ์ข้ามลูกค้า */
  const groupGone = (code: string) => badRequest(`กลุ่มผู้ใช้ ${code} ถูกลบไปแล้ว — ปิดหน้าต่างนี้ แล้วเปิดผู้ใช้ใหม่เพื่อเลือกกลุ่มอื่น (หรือ "— ไม่มีกลุ่ม —")`, [{ field: 'user_group_id', message: 'เลือกกลุ่มอื่น' }]);
  /** ล็อกแถวกลุ่มในทรานแซกชันที่บันทึกผู้ใช้ — กันลบกลุ่มพร้อมกับบันทึกผู้ใช้เข้ากลุ่มนั้น (ลบกลุ่มล็อก FOR UPDATE แล้วนับสมาชิกในทรานแซกชันเดียวกัน) */
  async function lockGroup(tx: Db, groupId: string | null | undefined) {
    if (!groupId) return;
    const g = await tx.selectFrom('sys_user_group').select(['code', 'deleted_at']).where('id', '=', groupId).forShare().executeTakeFirst();
    if (!g || g.deleted_at) throw groupGone(g?.code ?? '');
  }
  async function checkUserScope(tenantId: string | null, b: z.infer<typeof userBody>) {
    let admin = false;
    if (b.user_group_id) {
      const g = await db.selectFrom('sys_user_group').select(['tenant_id', 'code', 'deleted_at']).where('id', '=', b.user_group_id).executeTakeFirst();
      if (!g || (g.tenant_id ?? null) !== tenantId) throw badRequest('กลุ่มผู้ใช้ต้องเป็นของลูกค้ารายเดียวกับผู้ใช้');
      // กลุ่มถูกลบไปแล้ว (HANDOFF 198 · ผู้ดูแลอีกคนลบระหว่างที่หน้าต่างนี้เปิดอยู่) — ไม่ให้บันทึกผู้ใช้เข้ากลุ่มที่ไม่มีแล้ว
      if (g.deleted_at) throw groupGone(g.code);
      admin = g.code === 'ADMIN';
    }
    // ผู้ใช้ที่ไม่ใช่กลุ่ม ADMIN ต้องเข้าได้อย่างน้อย 1 บริษัท — ไม่งั้นบันทึกได้แต่ใช้อะไรไม่ได้เลย (HANDOFF 159 · ข้อกำหนดเจ้าของ: ช่องบังคับเตือน)
    if (!admin && !b.companies.length) throw badRequest(NO_COMPANY, [{ field: 'companies', message: 'ติ๊กบริษัทอย่างน้อย 1 บริษัท' }]);
    if (b.companies.length) {
      const cs = await db.selectFrom('sys_company').select(['id', 'tenant_id']).where('id', 'in', b.companies).execute();
      if (cs.length !== b.companies.length || cs.some((c) => c.tenant_id !== tenantId)) throw badRequest('บริษัทที่ให้สิทธิ์ต้องเป็นของลูกค้ารายเดียวกับผู้ใช้');
    }
  }
  app.post('/api/v1/users', async (req) => {
    const a = requireAdmin(req);
    const b = parse(userBody, req.body);
    // ไม่ตั้งรหัสผ่าน = เชิญด้วยลิงก์ (HANDOFF 184) — ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์ เข้าระบบไม่ได้จนกว่าจะตั้ง
    if (!b.password && !b.invite) throw badRequest('ป้อนรหัสผ่านเริ่มต้น หรือเลือก "ให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ"', [{ field: 'password', message: 'ป้อนรหัสผ่าน' }]);
    const tenantId = await tenantFor(a, b.tenant_id, b.companies);
    if (tenantId) await requireDemoForProvider(db, a, tenantId);   // HANDOFF 204 ข้อ d2: ลูกค้าจริงสร้างผู้ใช้เองเท่านั้น
    await checkUserScope(tenantId, b);
    if (tenantId) {
      const maxU = await maxOf(tenantId, 'users');
      if (maxU != null) {
        const n = await db.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
        if (Number(n.n) >= maxU) throw badRequest(`แพ็กเกจนี้มีผู้ใช้ได้สูงสุด ${maxU} คน`);
      }
    }
    return db.transaction().execute(async (tx) => {
      await lockGroup(tx, b.user_group_id);
      const u = await tx.insertInto('sys_user').values({ tenant_id: tenantId, username: b.username, display_name: b.display_name, password_hash: b.password ? await bcrypt.hash(b.password, 10) : null, user_group_id: b.user_group_id ?? null, approval_level: b.approval_level, check_rights: b.check_rights, single_session: b.single_session ?? false, app_access: appAccessValue(b.app_access), status: b.status, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      for (const c of b.companies) await tx.insertInto('sys_user_company').values({ company_id: c, user_id: u.id, created_by: a.userId }).execute();
      if (b.password) await markPasswordChanged(tx, u.id);
      await logActivity(tx, a, { module: 'SYS', action: 'ADD_USER', table: 'sys_user', rowId: u.id, detail: { username: b.username, tenant_id: tenantId, invite: !b.password, app_access: normalizeAppAccess(b.app_access ?? null) } });
      return u;
    });
  });
  app.put('/api/v1/users/:id', async (req) => {
    const a = requireAdmin(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(userBody, req.body);
    const cur = await db.selectFrom('sys_user').select(['tenant_id', 'app_access']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur || (!a.isPlatform && cur.tenant_id !== a.tenantId)) throw notFound('ผู้ใช้');
    // HANDOFF 204 ข้อ d1/d2: ผู้ให้บริการแก้ผู้ใช้ของลูกค้าจริงไม่ได้ (รวมตั้งรหัสผ่าน) — ปลดล็อก/ล้าง 2FA/ส่งลิงก์ทางอีเมลที่ศูนย์ผู้ให้บริการ
    if (cur.tenant_id) await requireDemoForProvider(db, a, cur.tenant_id);
    if (id === a.userId && b.status === 'I') throw badRequest('ปิดการใช้งานบัญชีของตัวเองไม่ได้');
    await checkUserScope(cur.tenant_id, b);
    await db.transaction().execute(async (tx) => {
      await lockGroup(tx, b.user_group_id);
      const patch: Record<string, unknown> = { username: b.username, display_name: b.display_name, user_group_id: b.user_group_id ?? null, approval_level: b.approval_level, check_rights: b.check_rights, status: b.status, updated_by: a.userId };
      if (b.password) patch.password_hash = await bcrypt.hash(b.password, 10);
      if (b.app_access !== undefined) patch.app_access = appAccessValue(b.app_access);
      if (b.single_session !== undefined) patch.single_session = b.single_session;
      await tx.updateTable('sys_user').set(patch).where('id', '=', id).execute();
      if (b.password) await setSec(tx, id, { password_changed_at: new Date().toISOString(), failed_logins: 0, locked_until: null }); // ตั้งรหัสใหม่ = ปลดล็อกด้วย
      await tx.deleteFrom('sys_user_company').where('user_id', '=', id).execute();
      for (const c of b.companies) await tx.insertInto('sys_user_company').values({ company_id: c, user_id: id, created_by: a.userId }).execute();
      if (b.status === 'I' || b.password) await tx.updateTable('sys_session').set({ ended_at: sql`now()` as never }).where('user_id', '=', id).where('ended_at', 'is', null).where('id', '<>', a.sessionId).execute();
      await logActivity(tx, a, { module: 'SYS', action: 'EDIT_USER', table: 'sys_user', rowId: id, detail: { password_changed: !!b.password, ...(b.app_access !== undefined ? { app_access: { before: normalizeAppAccess(cur.app_access), after: normalizeAppAccess(b.app_access) } } : {}) } });
      // ตั้งรหัสผ่านให้ผู้ใช้อื่น (S-SEC-06 กรณีลืมรหัสผ่าน) — แยกเหตุการณ์ไว้ในรายงานการใช้รหัสผ่าน
      if (b.password && id !== a.userId) await logActivity(tx, a, { module: 'SYS', action: 'RESET_PASSWORD', docNo: b.username, table: 'sys_user', rowId: id });
    });
    return { id };
  });
  app.post('/api/v1/user-groups', async (req) => {
    const a = requireAdmin(req);
    const b = parse(z.object({ code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1).max(120), tenant_id: uuid.nullable().optional() }), req.body);
    const tenantId = await tenantFor(a, b.tenant_id);
    if (tenantId) await requireDemoForProvider(db, a, tenantId);   // HANDOFF 204
    return db.insertInto('sys_user_group').values({ code: b.code, name: b.name, tenant_id: tenantId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
  });
  /**
   * เปลี่ยนชื่อ / ลบกลุ่ม (HANDOFF 198 · เจ้าของ 26/11/2569 "จะเพิ่มกลุ่มก็ควรอยู่หน้านั้น") — แท็บกลุ่มผู้ใช้ในหน้าผู้ใช้งานระบบ
   * เฉพาะกลุ่มของลูกค้าเดียวกัน (กลุ่มของลูกค้ารายอื่น = ไม่พบ · ข้อ 7.1) · รหัสกลุ่มเปลี่ยนไม่ได้ (กลุ่มตั้งต้นใช้รหัสตรวจว่ามีแล้ว)
   * ลบได้เฉพาะกลุ่มที่ไม่มีสมาชิก และไม่ใช่ ADMIN — ตั้ง deleted_at ทั้งกลุ่มและแถวสิทธิ์ของกลุ่มทุกบริษัท (รหัสกลุ่มว่าง ใช้ใหม่ได้)
   */
  const groupOf = async (a: AuthContext, id: string) => {
    const g = await db.selectFrom('sys_user_group').select(['id', 'code', 'name', 'tenant_id']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!g || (!a.isPlatform && g.tenant_id !== a.tenantId)) throw notFound('กลุ่มผู้ใช้');
    if (g.tenant_id) await requireDemoForProvider(db, a, g.tenant_id);   // HANDOFF 204
    return g;
  };
  app.put('/api/v1/user-groups/:id', async (req) => {
    const a = requireAdmin(req);
    const g = await groupOf(a, parse(z.object({ id: uuid }), req.params).id);
    const b = parse(z.object({ name: z.string().trim().min(1, 'ป้อนชื่อกลุ่ม').max(120) }), req.body);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('sys_user_group').set({ name: b.name, updated_by: a.userId, updated_at: sql`now()` as never, row_version: sql`row_version + 1` as never }).where('id', '=', g.id).execute();
      await logActivity(tx, a, { module: 'SET.SEC', action: 'EDIT_GROUP', docNo: g.code, table: 'sys_user_group', rowId: g.id, detail: { before: g.name, after: b.name } });
    });
    return { id: g.id };
  });
  app.delete('/api/v1/user-groups/:id', async (req) => {
    const a = requireAdmin(req);
    const g = await groupOf(a, parse(z.object({ id: uuid }), req.params).id);
    if (g.code === 'ADMIN') throw badRequest('ลบกลุ่ม ADMIN ไม่ได้ — กลุ่มผู้ดูแลระบบต้องมีเสมอ');
    await db.transaction().execute(async (tx) => {
      // ล็อกแถวกลุ่มก่อนนับสมาชิก — ผู้ดูแลอีกคนที่กำลังบันทึกผู้ใช้เข้ากลุ่มนี้ต้องรอ แล้วได้ "กลุ่มถูกลบไปแล้ว"
      await tx.selectFrom('sys_user_group').select('id').where('id', '=', g.id).forUpdate().execute();
      const n = Number((await tx.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('user_group_id', '=', g.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow()).n);
      if (n) throw badRequest(`กลุ่ม ${g.code} มีผู้ใช้ ${n} คน — ย้ายผู้ใช้ไปกลุ่มอื่นก่อน (แท็บผู้ใช้ › แก้ไขผู้ใช้ › กลุ่มผู้ใช้) แล้วจึงลบกลุ่ม`);
      const p = await tx.updateTable('sys_permission').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('subject_type', '=', 'G').where('subject_id', '=', g.id).where('deleted_at', 'is', null).executeTakeFirst();
      await tx.updateTable('sys_user_group').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', g.id).execute();
      await logActivity(tx, a, { module: 'SET.SEC', action: 'DELETE_GROUP', docNo: g.code, table: 'sys_user_group', rowId: g.id, detail: { name: g.name, permission_rows: Number(p.numUpdatedRows) } });
    });
    return { id: g.id };
  });
  /**
   * กลุ่มตั้งต้น (ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ฝ่ายการเงิน ฝ่ายธุรการ ฝ่ายบุคคล ดูอย่างเดียว) — ผู้ดูแลของลูกค้ากดเอง (HANDOFF 197)
   * ลูกค้า = ของผู้ดูแล (ผู้ให้บริการ = ลูกค้าเจ้าของบริษัทที่เลือกอยู่) · ทำซ้ำได้: สร้างเฉพาะกลุ่มที่ยังไม่มี ใส่สิทธิ์เฉพาะบริษัทที่กลุ่มยังไม่มีแถวสิทธิ์ (ไม่เขียนทับที่แก้เอง)
   */
  app.post('/api/v1/user-groups/standard', async (req) => {
    const a = requireAdmin(req);
    const tenantId = a.isPlatform ? (a.companyId ? (await db.selectFrom('sys_company').select('tenant_id').where('id', '=', a.companyId).executeTakeFirst())?.tenant_id ?? null : null) : a.tenantId;
    if (!tenantId) throw badRequest('เลือกบริษัทของลูกค้าก่อน — กลุ่มตั้งต้นเป็นของลูกค้าแต่ละราย');
    return db.transaction().execute(async (tx) => {
      const r = await ensureStandardGroups(tx, tenantId, a.userId, { createGroups: true });
      await logActivity(tx, a, { module: 'SYS', action: 'STANDARD_GROUPS', table: 'sys_user_group', detail: r });
      return r;
    });
  });

  /* ---------------------------------------------------------------- ลูกค้าผู้ใช้บริการ (tenant) — เฉพาะเจ้าหน้าที่ผู้ให้บริการ */
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  app.get('/api/v1/tenants', async (req) => {
    requirePlatform(req);
    return db.selectFrom('sys_tenant as t').select(['t.id', 't.code', 't.name', 't.contact_email', 't.contact_phone', 't.plan', 't.max_companies', 't.max_users', 't.expires_on', 't.status',
      't.dpa_signed_on', 't.is_demo', 't.terminated_on', 't.purge_after', 't.purged_at', 't.moved_to', 't.single_session',
      't.suspend_reason', 't.package_id', 't.docs_per_month', 't.file_quota_mb', 't.ai_per_month', 't.over_action', 't.ai_payer', 't.ai_limit_usd',
      sql<string | null>`(SELECT p.name_th FROM sys_package p WHERE p.id = t.package_id)`.as('package_name'),
      sql<number>`(SELECT count(*) FROM sys_company c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL)`.as('company_count'),
      sql<number>`(SELECT count(*) FROM sys_user u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL)`.as('user_count')])
      .where('t.deleted_at', 'is', null).orderBy('t.code').execute()
      // HANDOFF 204 M2: ผู้ติดต่อของลูกค้าจริงแสดงแบบปิดบัง (ผู้ให้บริการเปลี่ยนไม่ได้ — C3)
      .then((rows) => rows.map((r) => (r.is_demo ? r : { ...r, contact_email: r.contact_email ? maskEmail(r.contact_email) : null, contact_phone: r.contact_phone ? maskPhone(r.contact_phone) : null })));
  });
  const tenantBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสลูกค้า').max(20).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1, 'ป้อนชื่อลูกค้า').max(120),
    // HANDOFF 204 M2/C3: ลูกค้าจริงแสดงแบบปิดบัง (ab***@x) — ส่งคืนค่าปิดบัง = ไม่เปลี่ยน
    contact_email: z.string().trim().refine((v) => !v || /^[^@\s]{0,2}\*\*\*@\S+$/.test(v) || z.string().email().safeParse(v).success, 'อีเมลไม่ถูกต้อง').nullable().optional(), contact_phone: opt(60), plan: z.string().trim().max(20).default('standard'),
    max_companies: z.coerce.number().int().min(1).nullable().optional(), max_users: z.coerce.number().int().min(1).nullable().optional(),
    expires_on: isoDate.nullable().optional(), status: z.enum(['A', 'S', 'I']).default('A'), dpa_signed_on: isoDate.nullable().optional(),
    moved_to: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
    // 1 รหัสเข้าได้ทีละ 1 เครื่อง ทุกผู้ใช้ของลูกค้า (HANDOFF 156 · ค่าเริ่มต้น ปิด) · ไม่ส่ง = คงค่าเดิม — มีผลตั้งแต่การเข้าระบบครั้งถัดไป
    single_session: z.boolean().optional(),
    // แพ็กเกจ (HANDOFF 185): ว่าง = ไม่มีแพ็กเกจ · ขีดจำกัดของลูกค้า ว่าง = ตามแพ็กเกจ · ไม่ส่ง = คงค่าเดิม
    ...TENANT_PACKAGE_FIELDS,
    // เหตุที่ระงับ (HANDOFF 186): ค้างชำระ = นับ 30 วันแล้วลบข้อมูล · อื่น ๆ = ไม่นับ · ไม่ส่ง (สถานะ S) = อื่น ๆ
    suspend_reason: z.enum(['UNPAID', 'OTHER']).nullable().optional(),
  });
  /** สร้างลูกค้าใหม่ + กลุ่ม ADMIN ของลูกค้า + ผู้ดูแลคนแรกของลูกค้า */
  /**
   * สร้างลูกค้าใหม่ + กลุ่ม ADMIN ของลูกค้า + ผู้ดูแลคนแรกของลูกค้า
   * HANDOFF 204 ข้อ d1/d2: ลูกค้าจริง = ผู้ให้บริการไม่ตั้งรหัสผ่าน — ระบบส่งลิงก์ตั้งรหัสผ่านไปอีเมลผู้ติดต่อของลูกค้า (ผู้ให้บริการไม่เห็นลิงก์)
   * ลูกค้าข้อมูลตัวอย่าง (is_demo) = ตั้งรหัสผ่านเริ่มต้นได้เหมือนเดิม (ให้ลูกค้าทดลองใช้)
   */
  app.post('/api/v1/tenants', async (req) => {
    const a = requirePlatform(req);
    const b = parse(tenantBody.extend({ admin_username: userBody.shape.username, admin_name: userBody.shape.display_name, is_demo: z.boolean().default(false),
      admin_password: z.string().max(200).optional().transform((v) => v || undefined).refine((p) => !p || !passwordProblem(p), (p) => ({ message: (p && passwordProblem(p)) ?? '' })) }), req.body);
    if (b.is_demo && !b.admin_password) throw badRequest('ป้อนรหัสผ่านเริ่มต้นของผู้ดูแล (ลูกค้าข้อมูลตัวอย่าง)', [{ field: 'admin_password', message: 'ป้อนรหัสผ่าน' }]);
    if (!b.is_demo && b.admin_password) throw badRequest('ลูกค้าจริง: ผู้ให้บริการตั้งรหัสผ่านให้ผู้ดูแลของลูกค้าไม่ได้ (ข้อมูลของลูกค้าเป็นความลับ) — เว้นช่องรหัสผ่าน ระบบส่งลิงก์ตั้งรหัสผ่านไปที่อีเมลผู้ติดต่อของลูกค้า', [{ field: 'admin_password', message: 'เว้นว่าง' }]);
    if (!b.is_demo && !b.contact_email) throw badRequest('ป้อนอีเมลผู้ติดต่อของลูกค้า — ลิงก์ตั้งรหัสผ่านของผู้ดูแลคนแรกส่งไปที่อีเมลนี้', [{ field: 'contact_email', message: 'ป้อนอีเมล' }]);
    const t = await db.transaction().execute(async (tx) => {
      const t = await createTenantWithAdmin(tx, a.userId, { ...b, ...(await packagePlan(tx, b)), admin_username: b.admin_username, admin_name: b.admin_name, password_hash: b.admin_password ? await bcrypt.hash(b.admin_password, 10) : null });
      if (b.is_demo) await tx.updateTable('sys_tenant').set({ is_demo: true }).where('id', '=', t.id).execute();
      await logActivity(tx, a, { module: 'SYS', action: 'NEW_TENANT', table: 'sys_tenant', rowId: t.id, detail: { code: b.code, is_demo: b.is_demo } });
      return t;
    });
    if (b.is_demo) return t;
    const admin = await db.selectFrom('sys_user').select(['id', 'username', 'display_name']).where('tenant_id', '=', t.id).where('username', '=', b.admin_username).executeTakeFirstOrThrow();
    return { ...t, invite: await emailInvite(db, publicBase(req), a, { ...admin, tenant_id: t.id }, { bootstrap: true }) };
  });
  /**
   * ผู้ใช้ดูอย่างเดียว (HANDOFF 154 · เจ้าของ "เชิญลูกค้าทดลองก่อน"): ให้ลูกค้าทดลองดูข้อมูลตัวอย่างทั้งปี (ลูกค้า DEMO) โดยแก้ไม่ได้
   * กลุ่ม VIEW ของลูกค้านั้น = สิทธิ์ "ทุกระบบงาน" อ่าน Y · พิมพ์ S (ออกจอเท่านั้น — ไม่นับครั้งที่พิมพ์ของเอกสารตัวอย่าง) · เพิ่ม/แก้/ยกเลิก/ลบ/รับรอง N ทุกบริษัทของลูกค้า
   * ผู้ใช้ = ตรวจสอบสิทธิ์ก่อนใช้งาน · ระดับอนุมัติ 0 · เปิดได้เฉพาะ Buddy · เข้าได้ทุกบริษัทของลูกค้านั้น — อยู่ใน tenant นั้นเท่านั้น (เห็นลูกค้ารายอื่นไม่ได้)
   */
  app.post('/api/v1/tenants/:id/viewers', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ username: userBody.shape.username, display_name: userBody.shape.display_name,
      password: z.string().max(200).refine((p) => !passwordProblem(p), (p) => ({ message: passwordProblem(p) ?? '' })) }), req.body);
    const t = await db.selectFrom('sys_tenant').select(['id', 'code', 'max_users', 'status']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    // HANDOFF 204 ข้อ d2: ผู้ใช้ดูอย่างเดียว (รหัสผ่านที่ผู้ให้บริการตั้ง) = เข้าดูข้อมูลลูกค้าได้ — ทำได้เฉพาะลูกค้าข้อมูลตัวอย่าง
    await requireDemoForProvider(db, a, id);
    if (await db.selectFrom('sys_user').select('id').where(sql`lower(username)`, '=', b.username.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst()) throw badRequest(`รหัสผู้ใช้ ${b.username} มีผู้ใช้แล้ว — เลือกรหัสอื่น`);
    const maxU = await maxOf(id, 'users');
    if (maxU != null) {
      const n = await db.selectFrom('sys_user').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      if (Number(n.n) >= maxU) throw badRequest(`แพ็กเกจของลูกค้านี้มีผู้ใช้ได้สูงสุด ${maxU} คน — เพิ่มจำนวนผู้ใช้ที่ลูกค้าก่อน`);
    }
    const companies = await db.selectFrom('sys_company').select('id').where('tenant_id', '=', id).where('deleted_at', 'is', null).execute();
    if (!companies.length) throw badRequest('ลูกค้านี้ยังไม่มีบริษัท — ไม่มีข้อมูลให้ดู');
    const all = await db.selectFrom('sys_menu').select('id').where('code', '=', 'ALL').where('deleted_at', 'is', null).executeTakeFirst();
    if (!all) throw new AppError(500, 'NO_MENU', 'ไม่พบเมนู "ทุกระบบงาน" ในตารางเมนู');
    return db.transaction().execute(async (tx) => {
      let g = await tx.selectFrom('sys_user_group').select('id').where('tenant_id', '=', id).where('code', '=', 'VIEW').where('deleted_at', 'is', null).executeTakeFirst();
      if (!g) g = await tx.insertInto('sys_user_group').values({ tenant_id: id, code: 'VIEW', name: 'ดูอย่างเดียว (อ่าน/พิมพ์ออกจอ)', created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      for (const c of companies) {
        await tx.updateTable('sys_permission').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', c.id).where('subject_type', '=', 'G').where('subject_id', '=', g.id).where('deleted_at', 'is', null).execute();
        await tx.insertInto('sys_permission').values({ company_id: c.id, subject_type: 'G', subject_id: g.id, menu_id: all.id, can_read: 'Y', can_add: 'N', can_edit: 'N', can_cancel: 'N', can_delete: 'N', can_print: 'S', can_approve: 'N', created_by: a.userId }).execute();
      }
      const u = await tx.insertInto('sys_user').values({ tenant_id: id, username: b.username, display_name: b.display_name, password_hash: await bcrypt.hash(b.password, 10), user_group_id: g.id, approval_level: 0, check_rights: true,
        app_access: appAccessValue(['buddy']), status: 'A', created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      for (const c of companies) await tx.insertInto('sys_user_company').values({ company_id: c.id, user_id: u.id, created_by: a.userId }).execute();
      await markPasswordChanged(tx, u.id);
      await logActivity(tx, a, { module: 'SYS', action: 'ADD_USER', table: 'sys_user', rowId: u.id, detail: { username: b.username, tenant_id: id, viewer: true, companies: companies.length } });
      return { id: u.id, username: b.username, tenant_code: t.code, companies: companies.length };
    });
  });
  /**
   * เพิ่มกลุ่มตั้งต้น (ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ดูอย่างเดียว) ให้ลูกค้าที่สร้างก่อนมีกลุ่มตั้งต้น — HANDOFF 159
   * เจ้าหน้าที่ผู้ให้บริการกดทีละลูกค้า · ทำซ้ำได้: สร้างเฉพาะกลุ่มที่ยังไม่มี ใส่สิทธิ์เฉพาะบริษัทที่กลุ่มยังไม่มีแถวสิทธิ์ (ไม่เขียนทับที่ลูกค้าแก้เอง)
   */
  app.post('/api/v1/tenants/:id/standard-groups', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const t = await db.selectFrom('sys_tenant').select(['id', 'code', 'purged_at']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t || t.purged_at) throw notFound('ลูกค้าผู้ใช้บริการ');
    return db.transaction().execute(async (tx) => {
      const r = await ensureStandardGroups(tx, id, a.userId, { createGroups: true });
      await logActivity(tx, a, { module: 'SYS', action: 'TENANT_STANDARD_GROUPS', docNo: t.code, table: 'sys_tenant', rowId: id, detail: r });
      return { ...r, tenant_code: t.code };
    });
  });
  app.put('/api/v1/tenants/:id', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(tenantBody, req.body);
    const cur = await db.selectFrom('sys_tenant').select(['status', 'suspend_reason', 'terminated_on', 'purge_after', 'purged_at', 'ai_payer', 'ai_limit_usd', 'contact_email', 'contact_phone', 'code']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('ลูกค้าผู้ใช้บริการ');
    if (cur.purged_at) throw badRequest('ลบข้อมูลของลูกค้ารายนี้ไปแล้ว (เลิกใช้บริการ) — แก้ไขหรือเปิดใช้อีกไม่ได้ สร้างลูกค้ารายใหม่แทน');
    if (b.moved_to && b.status !== 'I') throw badRequest('ลูกค้าที่ย้ายไปเซิร์ฟเวอร์แยกแล้วต้องมีสถานะ "เลิกใช้" ที่เครื่องนี้');
    // T0.17 + HANDOFF 186: เลิกใช้ (I) หรือ ระงับ — ค้างชำระ (S/UNPAID) = นับ TENANT_RETENTION_DAYS วันแล้วลบได้ (นับอยู่แล้ว = วันเดิม) · ใช้งาน / ระงับเหตุอื่น = ยกเลิกการนับ
    const pkg = await packagePlan(db, b);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const suspend_reason = b.status === 'S' ? (b.suspend_reason ?? 'OTHER') : null;
    const end = tenantCountdown({ status: b.status, suspend_reason }, cur, today);
    // HANDOFF 204 C3: อีเมลผู้ติดต่อของลูกค้าจริง ผู้ให้บริการเปลี่ยนไม่ได้ (ผู้ดูแลของลูกค้าเปลี่ยนเองในบัญชีของตัวเอง) — ค่าที่ส่งมาแบบปิดบัง = ไม่เปลี่ยน
    const demo = await tenantIsDemo(db, id);
    const sameOrMasked = (v: string | null | undefined) => !v || v.toLowerCase() === (cur.contact_email ?? '').toLowerCase() || (!!cur.contact_email && v === maskEmail(cur.contact_email));
    const samePhone = (v: string | null | undefined) => !v || v === (cur.contact_phone ?? '') || (!!cur.contact_phone && v === maskPhone(cur.contact_phone));
    if (!demo && (!sameOrMasked(b.contact_email) || !samePhone(b.contact_phone))) throw forbidden(`อีเมล/โทรศัพท์ผู้ติดต่อของลูกค้าจริง (${cur.code}) ผู้ให้บริการเปลี่ยนไม่ได้ — ผู้ดูแลระบบของลูกค้าเปลี่ยนเองที่ เริ่มระบบ › ผู้ใช้งานและสิทธิ์ (HANDOFF 204)`);
    if (!demo) { b.contact_email = cur.contact_email; b.contact_phone = cur.contact_phone; }
    // ลูกค้าข้อมูลตัวอย่าง: เปลี่ยน = จดเวลา + แจ้งอีเมลเดิม
    const emailChanged = (cur.contact_email ?? '').toLowerCase() !== (b.contact_email ?? '').toLowerCase();
    await db.updateTable('sys_tenant').set({ ...b, ...end, ...pkg, suspend_reason, ...(emailChanged ? { contact_email_changed_at: sql`now()` as never } : {}), contact_email: b.contact_email ?? null, contact_phone: b.contact_phone ?? null, max_companies: b.max_companies ?? null, max_users: b.max_users ?? null, expires_on: b.expires_on ?? null, dpa_signed_on: b.dpa_signed_on ?? null, moved_to: b.moved_to ?? null, updated_by: a.userId }).where('id', '=', id).execute();
    if (emailChanged && cur.contact_email) noticeCustomer(db, publicBase(req), id, `แจ้งเตือน: เปลี่ยนอีเมลผู้ติดต่อของบัญชี ${cur.code}`, [
      `ผู้ให้บริการ Buddy Account เปลี่ยนอีเมลผู้ติดต่อของบัญชีท่านจาก ${cur.contact_email} เป็น ${b.contact_email ?? '(ไม่มี)'} เมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
      'ถ้าท่านไม่ได้ขอ โปรดแจ้งผู้ให้บริการทันที'], cur.contact_email);
    if (b.status !== 'A') await db.updateTable('sys_session').set({ ended_at: sql`now()` as never }).where('ended_at', 'is', null).where('user_id', 'in', db.selectFrom('sys_user').select('id').where('tenant_id', '=', id)).execute();
    await logActivity(db, a, { module: 'SYS', action: 'EDIT_TENANT', table: 'sys_tenant', rowId: id, detail: { status: b.status, ...(cur.status !== b.status || cur.suspend_reason !== suspend_reason || cur.purge_after !== end.purge_after ? { from: cur.status, suspend_reason, purge_after: end.purge_after } : {}), ...(b.single_session !== undefined ? { single_session: b.single_session } : {}),
      ...(b.package_id !== undefined ? { package: pkg.plan ?? null, docs_per_month: b.docs_per_month, file_quota_mb: b.file_quota_mb, ai_per_month: b.ai_per_month, over_action: b.over_action } : {}),
      // HANDOFF 190: ผู้จ่ายค่า AI / เพดาน — บันทึกเมื่อเปลี่ยน (จาก → เป็น)
      ...((b.ai_payer !== undefined && b.ai_payer !== cur.ai_payer) || (b.ai_limit_usd !== undefined && (b.ai_limit_usd === null ? null : Number(b.ai_limit_usd)) !== (cur.ai_limit_usd === null ? null : Number(cur.ai_limit_usd)))
        ? { ai_payer: { from: cur.ai_payer, to: b.ai_payer ?? cur.ai_payer }, ai_limit_usd: { from: cur.ai_limit_usd, to: b.ai_limit_usd === undefined ? cur.ai_limit_usd : b.ai_limit_usd } } : {}) } });
    return { id };
  });
  /** T0.17 + HANDOFF 186: ลบข้อมูลทั้งหมดของลูกค้าที่เลิกใช้/ค้างชำระครบ TENANT_RETENTION_DAYS วันแล้ว — ผู้ให้บริการกดเอง พิมพ์รหัสลูกค้ายืนยัน · ไม่ลบอัตโนมัติ · ย้อนกลับไม่ได้ */
  app.post('/api/v1/tenants/:id/purge', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ confirm: z.string().trim().max(20) }), req.body);
    const t = await db.selectFrom('sys_tenant').select(['code', 'status', 'suspend_reason', 'terminated_on', 'purge_after', 'purged_at', 'moved_to']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ลูกค้าผู้ใช้บริการ');
    if (t.purged_at) throw badRequest('ลบข้อมูลของลูกค้ารายนี้ไปแล้ว');
    if (!tenantCountingDown(t)) throw badRequest(`เปลี่ยนสถานะลูกค้าเป็น "เลิกใช้" หรือ "ระงับ — ค้างชำระ" ก่อน — ระบบให้เวลา ${TENANT_RETENTION_DAYS} วันให้ลูกค้าชำระเงินหรือขอสำเนาข้อมูลก่อนลบ`);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    // ย้ายไปเซิร์ฟเวอร์แยกแล้ว (T0.18): ข้อมูลอยู่ที่เครื่องใหม่ ลบสำเนาเดิมได้ทันที
    if (!t.moved_to && today < t.purge_after!) throw badRequest(`ลบได้ตั้งแต่วันที่ ${formatDate(t.purge_after!, 'B')} (${t.status === 'I' ? 'เลิกใช้บริการ' : 'ระงับเพราะค้างชำระ'} + ${TENANT_RETENTION_DAYS} วัน) — ระหว่างนี้ลูกค้ายังชำระเงินหรือขอสำเนาข้อมูลได้`);
    if (b.confirm.toUpperCase() !== t.code.toUpperCase()) throw badRequest(`พิมพ์รหัสลูกค้า ${t.code} เพื่อยืนยัน — ข้อมูลทุกบริษัทของลูกค้ารายนี้จะถูกลบถาวร`);
    const r = await purgeTenant(db, id);
    // HANDOFF 204 ข้อ d5: แจ้งลูกค้าว่าลบข้อมูลแล้ว (อีเมลผู้ติดต่อ — ลูกค้าเลิกใช้แล้ว)
    noticeCustomer(db, publicBase(req), id, `แจ้ง: ลบข้อมูลบัญชี ${t.code} ตามกำหนดแล้ว`, [`ผู้ให้บริการ Buddy Account ลบข้อมูลทั้งหมดของบัญชี ${t.code} ตามกำหนดเวลาเก็บรักษาข้อมูลหลังเลิกใช้บริการ เมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`]);
    await logActivity(db, a, { module: 'SYS', action: 'PURGE_TENANT', docNo: t.code, table: 'sys_tenant', rowId: id, detail: r });
    return r;
  });

  /** แฟ้มบันทึกเหตุการณ์ที่ผู้ใช้นี้ดูได้: บริษัทที่เข้าได้ + เหตุการณ์ระบบ (ไม่มีบริษัท) ของผู้ใช้ในลูกค้าเดียวกัน — ผู้ให้บริการ = ของเจ้าหน้าที่ผู้ให้บริการ */
  const logScope = (companies: Array<{ id: string }>, a: AuthContext) =>
    sql<boolean>`(l.company_id = ANY(${companies.map((c) => c.id)}::uuid[]) OR (l.company_id IS NULL AND ${a.tenantId ? sql`u.tenant_id = ${a.tenantId}` : sql`u.tenant_id IS NULL`}))`;
  /* ---------------------------------------------------------------- แฟ้มบันทึกเหตุการณ์ (บทที่ 23 S-SEC-04) — อ่านอย่างเดียว */
  app.get('/api/v1/activity-log', async (req) => {
    const a = requireAuth(req);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), table: z.string().optional(), row_id: uuid.optional() }), req.query);
    let s = db.selectFrom('sys_activity_log as l').leftJoin('sys_user as u', 'u.id', 'l.user_id')
      .select(['l.seq', 'l.occurred_at', 'l.module', 'l.action', 'l.doc_no', 'l.table_name', 'l.row_id', 'l.detail', 'u.username', 'u.display_name']);
    if (!a.isAdmin) s = s.where('l.user_id', '=', a.userId);
    {
      // ลูกค้าเห็นเฉพาะเหตุการณ์ของบริษัทใน tenant ตัวเอง และเหตุการณ์ระบบของผู้ใช้ใน tenant ตัวเอง
      // HANDOFF 204: ผู้ให้บริการเห็นเฉพาะบริษัทของลูกค้าข้อมูลตัวอย่าง + เหตุการณ์ระบบของเจ้าหน้าที่ผู้ให้บริการ (ไม่เห็นเลขที่เอกสาร/รายละเอียดของลูกค้าจริง)
      s = s.where(logScope(await companiesForUser(db, a), a));
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
    s = s.where(logScope(await companiesForUser(db, a), a));   // HANDOFF 204
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

export async function defaultTenant(db: Db) {
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
