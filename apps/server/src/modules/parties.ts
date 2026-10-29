import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { checkTaxId, d, ZERO, addMonths } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { fiscalYearOf } from './gl/balances.js';

const uuid = z.string().uuid();
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)));

/** ตารางอ้างอิงที่หน้าจอลูกค้า/ผู้จำหน่าย/พนักงานขายใช้ (คู่มือบทที่ 6 ตารางข้อมูล): 40 เขตการขาย 41 ขนส่งโดย 45 ประเภทลูกค้า 46 ประเภทผู้จำหน่าย 47 ประเภทพนักงานขาย 55 หมวดภาษีหัก ณ ที่จ่าย */
export function lookupRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/lookups', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ types: z.string().regex(/^[A-Z0-9,]+$/i, 'ระบุชนิดตาราง เช่น 40,41') }), req.query);
    const types = q.types.split(',');
    const rows = await db.selectFrom('md_lookup').select(['type_code', 'code', 'name_th', 'short_th']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('status', '=', 'A').where('type_code', 'in', types.filter((t) => t !== 'BANK')).orderBy('type_code').orderBy('code').execute();
    const out: Record<string, Array<{ code: string; name: string }>> = Object.fromEntries(types.map((t) => [t, []]));
    for (const r of rows) out[r.type_code]!.push({ code: r.code, name: r.name_th });
    if (types.includes('BANK')) out.BANK = (await db.selectFrom('md_bank').select(['code', 'name_th']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').execute()).map((b) => ({ code: b.code, name: b.name_th }));
    return out;
  });
}

/**
 * ตรวจเลขผู้เสียภาษี (บังคับป้อนเมื่อค่าเริ่มต้น "ยอมให้ว่างได้" ไม่ติ๊ก — คู่มือบทที่ 5 ข้อ 5.3) และเลขสาขา 5 หลัก
 * บังคับเฉพาะรายใหม่ และรายเดิมที่เคยมีเลขแล้ว — รายที่ย้ายมาจาก Express โดยไม่มีเลข (เช่น ต่างประเทศ) ยังแก้ไขได้
 */
async function checkTax(db: Db, companyId: string, taxId: string | null, branch: string | null, prevTaxId?: string | null) {
  const issues: Array<{ field: string; message: string }> = [];
  if (taxId) { const c = checkTaxId(taxId); if (!c.ok) issues.push({ field: 'tax_id', message: c.error! }); }
  else if (prevTaxId !== null && (await companySettings(db, companyId))['gen.allow_blank_party_tax_id'] === false)
    issues.push({ field: 'tax_id', message: 'ป้อนเลขประจำตัวผู้เสียภาษี — ถ้าคู่ค้าไม่มีเลข (เช่น ต่างประเทศ) ให้ติ๊ก "ยอมให้เลขผู้เสียภาษีว่างได้" ที่ เริ่มระบบ › ค่าเริ่มต้นแต่ละระบบ › เรื่องทั่วไป' });
  if (branch && !/^\d{1,5}$/.test(branch)) issues.push({ field: 'tax_branch_no', message: 'สาขา# เป็นตัวเลขไม่เกิน 5 หลัก (สำนักงานใหญ่ = 00000)' });
  if (issues.length) throw badRequest(issues[0]!.message, issues);
  return { tax_id: taxId ? taxId.replace(/[\s-]/g, '') : null, tax_branch_no: branch ? branch.padStart(5, '0') : null };
}

/** บัญชีลูกหนี้/เจ้าหนี้ต้องเป็นบัญชีย่อยของบริษัทนี้ */
async function checkAccount(db: Db, companyId: string, id: string | null | undefined, field: string) {
  if (!id) return null;
  const acc = await db.selectFrom('gl_account').select(['account_no', 'is_control']).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!acc) throw badRequest('ไม่พบบัญชีนี้ในผังบัญชี', [{ field, message: 'ไม่พบบัญชี' }]);
  if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม ให้ใช้บัญชีย่อย`, [{ field, message: 'ต้องเป็นบัญชีย่อย' }]);
  return id;
}

const contactBody = z.object({ name: z.string().trim().min(1, 'ป้อนชื่อผู้ติดต่อ').max(120), position: str(60), phone: str(60), email: str(120), is_primary: z.boolean().default(false) });
async function saveContacts(db: Db, a: AuthContext & { companyId: string }, type: 'C' | 'S', partyId: string, rows: z.infer<typeof contactBody>[]) {
  await db.updateTable('md_party_contact').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('party_type', '=', type).where('party_id', '=', partyId).where('deleted_at', 'is', null).execute();
  if (rows.length) await db.insertInto('md_party_contact').values(rows.map((r, i) => ({ company_id: a.companyId, party_type: type, party_id: partyId, line_no: i + 1, ...r, created_by: a.userId }))).execute();
}
const contactsOf = (db: Db, companyId: string, type: 'C' | 'S', id: string) =>
  db.selectFrom('md_party_contact').select(['name', 'position', 'phone', 'email', 'is_primary']).where('company_id', '=', companyId).where('party_type', '=', type).where('party_id', '=', id).where('deleted_at', 'is', null).orderBy('line_no').execute();

/** ลูกค้า (S-AR-01) และผู้จำหน่าย (S-AP-01) — คู่มือบทที่ 7 */
export function partyRoutes(app: FastifyInstance, db: Db) {
  /* ---------------------------------------------------------------- ลูกค้า */
  const customerBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสลูกค้า').max(20), title: str(30), name: z.string().trim().min(1, 'ป้อนชื่อลูกค้า').max(120), name_en: str(120),
    address_1: str(100), address_2: str(100), address_3: str(100), zip_code: str(10), phone: str(60), email: str(120), contact: str(60), remark: str(2000),
    status: z.enum(['A', 'I']).default('A'), tax_id: str(20), tax_branch_no: str(5), customer_type: str(4), ar_account_id: uuid.nullable().optional(),
    salesperson_id: uuid.nullable().optional(), sales_area_code: str(10), ship_via_code: str(10), credit_days: num, payment_terms: str(60),
    price_level: z.enum(['', '0', '1', '2', '3', '4', '5']).nullable().optional().transform((v) => v || null), discount_text: str(20), credit_limit: num,
    wht_form: str(4), wht_rate: num, wht_category: str(4), wht_condition: z.enum(['', '1', '2', '3']).nullable().optional().transform((v) => v || null), default_ship_to: str(10),
    ship_tos: z.array(z.object({ code: z.string().trim().min(1, 'ป้อนรหัสสถานที่ส่ง').max(10), address_1: str(100), address_2: str(100), address_3: str(100), zip_code: str(10), phone: str(60), contact: str(60) })).max(200).default([]),
    contacts: z.array(contactBody).max(50).default([]),
  });

  app.get('/api/v1/customers', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), status: z.enum(['A', 'I', 'all']).default('A'), limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    let s = db.selectFrom('md_customer as c').leftJoin('md_salesperson as sp', 'sp.id', 'c.salesperson_id')
      .select(['c.id', 'c.code', 'c.title', 'c.name', 'c.tax_id', 'c.tax_branch_no', 'c.phone', 'c.contact', 'c.credit_days', 'c.credit_limit', 'c.status', 'sp.code as salesperson_code',
        sql<string>`(SELECT coalesce(sum(o.outstanding), 0) FROM v_ar_outstanding o WHERE o.customer_id = c.id)`.as('balance')])
      .where('c.company_id', '=', a.companyId).where('c.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('c.status', '=', q.status);
    if (q.q?.trim()) { const like = `%${q.q.trim()}%`; s = s.where((eb) => eb.or([eb('c.code', 'ilike', like), eb('c.name', 'ilike', like), eb('c.tax_id', 'ilike', like.replace(/-/g, '')), eb('c.phone', 'ilike', like), eb('c.contact', 'ilike', like)])); }
    const total = await s.clearSelect().select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    return { total: Number(total.n), rows: await s.orderBy('c.code').limit(q.limit).offset(q.offset).execute() };
  });

  app.get('/api/v1/customers/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await db.selectFrom('md_customer').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw notFound('ลูกค้า');
    const ship_tos = await db.selectFrom('md_customer_ship_to').select(['code', 'address_1', 'address_2', 'address_3', 'zip_code', 'phone', 'contact']).where('company_id', '=', a.companyId).where('customer_id', '=', id).where('deleted_at', 'is', null).orderBy('code').execute();
    const bills = await db.selectFrom('v_ar_outstanding').select(['header_id', 'doc_class', 'doc_no', 'doc_date', 'due_date', 'amount', 'outstanding']).where('company_id', '=', a.companyId).where('customer_id', '=', id).where('outstanding', '<>', '0').orderBy('due_date').orderBy('doc_no').execute();
    const last = await db.selectFrom('doc_header').select(sql<string | null>`max(doc_date)`.as('d')).where('company_id', '=', a.companyId).where('customer_id', '=', id).where('doc_class', '=', 'IV').where('doc_status', '<>', 'C').where('deleted_at', 'is', null).executeTakeFirst();
    return { ...c, ship_tos, contacts: await contactsOf(db, a.companyId, 'C', id), outstanding_bills: bills, balance: bills.reduce((t, b) => t.plus(d(b.outstanding)), ZERO).toFixed(2), last_invoice_date: last?.d ?? null };
  });

  async function saveCustomer(a: AuthContext & { companyId: string }, id: string | null, b: z.infer<typeof customerBody>) {
    const dup = await db.selectFrom('md_customer').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสลูกค้า ${b.code} มีอยู่แล้ว`);
    const prev = id ? await db.selectFrom('md_customer').select('tax_id').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const tax = await checkTax(db, a.companyId, b.tax_id, b.tax_branch_no, prev ? prev.tax_id : undefined);
    await checkAccount(db, a.companyId, b.ar_account_id, 'ar_account_id');
    if (b.salesperson_id && !(await db.selectFrom('md_salesperson').select('id').where('id', '=', b.salesperson_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบพนักงานขายนี้');
    const codes = new Set<string>();
    for (const s of b.ship_tos) { if (codes.has(s.code)) throw badRequest(`รหัสสถานที่ส่ง ${s.code} ซ้ำ`); codes.add(s.code); }
    if (b.default_ship_to && !codes.has(b.default_ship_to)) throw badRequest(`สถานที่ส่งประจำ ${b.default_ship_to} ไม่อยู่ในรายการสถานที่ส่งสินค้า`);
    const { ship_tos, contacts, ...h } = b;
    const row = { ...h, ...tax, ar_account_id: b.ar_account_id ?? null, salesperson_id: b.salesperson_id ?? null, credit_limit: b.credit_limit === null ? null : d(b.credit_limit).toFixed(2), wht_rate: b.wht_rate === null ? null : String(b.wht_rate), inactive_date: b.status === 'I' ? sql`COALESCE(inactive_date, CURRENT_DATE)` as never : null };
    return db.transaction().execute(async (tx) => {
      let cid = id;
      let before: unknown = null;
      if (id) {
        before = await tx.selectFrom('md_customer').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!before) throw notFound('ลูกค้า');
        await tx.updateTable('md_customer').set({ ...row, updated_by: a.userId }).where('id', '=', id).execute();
      } else {
        cid = (await tx.insertInto('md_customer').values({ ...row, inactive_date: b.status === 'I' ? sql`CURRENT_DATE` as never : null, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      await tx.updateTable('md_customer_ship_to').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('customer_id', '=', cid!).where('deleted_at', 'is', null).execute();
      if (ship_tos.length) await tx.insertInto('md_customer_ship_to').values(ship_tos.map((s) => ({ ...s, company_id: a.companyId, customer_id: cid!, created_by: a.userId }))).execute();
      await saveContacts(tx, a, 'C', cid!, contacts);
      await logActivity(tx, a, { module: 'AR', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'md_customer', rowId: cid, detail: id ? { before } : undefined });
      return { id: cid };
    });
  }
  app.post('/api/v1/customers', async (req) => saveCustomer(requireCompany(req), null, parse(customerBody, req.body)));
  app.put('/api/v1/customers/:id', async (req) => saveCustomer(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(customerBody, req.body)));
  app.delete('/api/v1/customers/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const c = await db.selectFrom('md_customer').select(['code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw notFound('ลูกค้า');
    const used = await db.selectFrom('doc_header').select('id').where('company_id', '=', a.companyId).where('customer_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (used) throw badRequest(`ลูกค้า ${c.code} มีเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.updateTable('md_customer').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'AR', action: 'DELETE', docNo: c.code, table: 'md_customer', rowId: id });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- ผู้จำหน่าย */
  const supplierBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสผู้จำหน่าย').max(20), title: str(30), name: z.string().trim().min(1, 'ป้อนชื่อผู้จำหน่าย').max(120), name_en: str(120),
    address_1: str(100), address_2: str(100), address_3: str(100), zip_code: str(10), phone: str(60), contact: str(60), remark: str(2000),
    status: z.enum(['A', 'I']).default('A'), on_hold: z.boolean().default(false), tax_id: str(20), tax_branch_no: str(5), supplier_type: str(4), ap_account_id: uuid.nullable().optional(),
    price_type: z.enum(['', '0', '1', '2']).nullable().optional().transform((v) => v || null), vat_rate: num, ship_via_code: str(10), credit_days: num, payment_terms: str(60), discount_text: str(20), credit_limit: num,
    wht_form: str(4), wht_income_desc: str(60), wht_rate: num, wht_condition: z.enum(['', '1', '2', '3']).nullable().optional().transform((v) => v || null),
    banks: z.array(z.object({ bank_code: z.string().trim().min(1, 'เลือกธนาคาร').max(10), branch: str(60), account_no: z.string().trim().min(1, 'ป้อนเลขที่บัญชี').max(20), account_name: str(120), is_default: z.boolean().default(false) })).max(20).default([]),
    contacts: z.array(contactBody).max(50).default([]),
  });

  app.get('/api/v1/suppliers', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), status: z.enum(['A', 'I', 'all']).default('A'), limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    let s = db.selectFrom('md_supplier as s')
      .select(['s.id', 's.code', 's.title', 's.name', 's.tax_id', 's.tax_branch_no', 's.phone', 's.contact', 's.credit_days', 's.credit_limit', 's.status', 's.on_hold', 's.wht_form',
        sql<string>`(SELECT coalesce(sum(o.outstanding), 0) FROM v_ap_outstanding o WHERE o.supplier_id = s.id)`.as('balance')])
      .where('s.company_id', '=', a.companyId).where('s.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('s.status', '=', q.status);
    if (q.q?.trim()) { const like = `%${q.q.trim()}%`; s = s.where((eb) => eb.or([eb('s.code', 'ilike', like), eb('s.name', 'ilike', like), eb('s.tax_id', 'ilike', like.replace(/-/g, '')), eb('s.phone', 'ilike', like), eb('s.contact', 'ilike', like)])); }
    const total = await s.clearSelect().select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    return { total: Number(total.n), rows: await s.orderBy('s.code').limit(q.limit).offset(q.offset).execute() };
  });

  app.get('/api/v1/suppliers/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await db.selectFrom('md_supplier').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('ผู้จำหน่าย');
    const banks = await db.selectFrom('md_supplier_bank').select(['bank_code', 'branch', 'account_no', 'account_name', 'is_default']).where('company_id', '=', a.companyId).where('supplier_id', '=', id).where('deleted_at', 'is', null).orderBy('line_no').execute();
    const bills = await db.selectFrom('v_ap_outstanding').select(['header_id', 'doc_class', 'doc_no', 'doc_date', 'due_date', 'amount', 'outstanding']).where('company_id', '=', a.companyId).where('supplier_id', '=', id).where('outstanding', '<>', '0').orderBy('due_date').orderBy('doc_no').execute();
    const last = await db.selectFrom('doc_header').select(sql<string | null>`max(doc_date)`.as('d')).where('company_id', '=', a.companyId).where('supplier_id', '=', id).where('doc_class', '=', 'RR').where('doc_status', '<>', 'C').where('deleted_at', 'is', null).executeTakeFirst();
    return { ...s, banks, contacts: await contactsOf(db, a.companyId, 'S', id), outstanding_bills: bills, balance: bills.reduce((t, b) => t.plus(d(b.outstanding)), ZERO).toFixed(2), last_bill_date: last?.d ?? null };
  });

  async function saveSupplier(a: AuthContext & { companyId: string }, id: string | null, b: z.infer<typeof supplierBody>) {
    const dup = await db.selectFrom('md_supplier').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสผู้จำหน่าย ${b.code} มีอยู่แล้ว`);
    const prev = id ? await db.selectFrom('md_supplier').select('tax_id').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    const tax = await checkTax(db, a.companyId, b.tax_id, b.tax_branch_no, prev ? prev.tax_id : undefined);
    await checkAccount(db, a.companyId, b.ap_account_id, 'ap_account_id');
    if (b.wht_rate !== null && (b.wht_rate < 0 || b.wht_rate > 100)) throw badRequest('อัตราภาษีที่หักต้องอยู่ระหว่าง 0–100%', [{ field: 'wht_rate', message: '0–100' }]);
    if (b.banks.filter((x) => x.is_default).length > 1) throw badRequest('บัญชีที่ใช้โอนเป็นประจำเลือกได้บัญชีเดียว');
    const { banks, contacts, ...h } = b;
    const row = { ...h, ...tax, ap_account_id: b.ap_account_id ?? null, credit_limit: b.credit_limit === null ? null : d(b.credit_limit).toFixed(2), wht_rate: b.wht_rate === null ? null : String(b.wht_rate), vat_rate: b.vat_rate === null ? null : String(b.vat_rate), inactive_date: b.status === 'I' ? sql`COALESCE(inactive_date, CURRENT_DATE)` as never : null };
    return db.transaction().execute(async (tx) => {
      let sid = id;
      let before: unknown = null;
      if (id) {
        before = await tx.selectFrom('md_supplier').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!before) throw notFound('ผู้จำหน่าย');
        await tx.updateTable('md_supplier').set({ ...row, updated_by: a.userId }).where('id', '=', id).execute();
      } else {
        sid = (await tx.insertInto('md_supplier').values({ ...row, inactive_date: b.status === 'I' ? sql`CURRENT_DATE` as never : null, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      await tx.updateTable('md_supplier_bank').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('supplier_id', '=', sid!).where('deleted_at', 'is', null).execute();
      if (banks.length) await tx.insertInto('md_supplier_bank').values(banks.map((x, i) => ({ ...x, line_no: i + 1, company_id: a.companyId, supplier_id: sid!, created_by: a.userId }))).execute();
      await saveContacts(tx, a, 'S', sid!, contacts);
      await logActivity(tx, a, { module: 'AP', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'md_supplier', rowId: sid, detail: id ? { before } : undefined });
      return { id: sid };
    });
  }
  app.post('/api/v1/suppliers', async (req) => saveSupplier(requireCompany(req), null, parse(supplierBody, req.body)));
  app.put('/api/v1/suppliers/:id', async (req) => saveSupplier(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(supplierBody, req.body)));
  app.delete('/api/v1/suppliers/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await db.selectFrom('md_supplier').select(['code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('ผู้จำหน่าย');
    const used = await db.selectFrom('doc_header').select('id').where('company_id', '=', a.companyId).where('supplier_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (used) throw badRequest(`ผู้จำหน่าย ${s.code} มีเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.updateTable('md_supplier').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'AP', action: 'DELETE', docNo: s.code, table: 'md_supplier', rowId: id });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- พนักงานขาย (S-SO-01) */
  const slmBody = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสพนักงานขาย').max(20), name: z.string().trim().min(1, 'ป้อนชื่อพนักงานขาย').max(120), position: str(60), salesperson_type: str(4),
    sales_area_code: str(10), commission_rate: num, address: str(500), zip_code: str(10), phone: str(60), tax_id: str(20), social_security_no: str(20), status: z.enum(['A', 'I']).default('A'),
    fiscal_year_id: uuid.optional(), targets: z.array(z.object({ period_id: uuid, amount: num })).max(24).default([]),
  });
  /** เป้าการขาย 24 งวด นับจากต้นปีบัญชี (ปีที่เลือกหรือตามวันทำการ) */
  async function targetPeriods(a: AuthContext & { companyId: string }, fyId?: string) {
    const fy = fyId ? await db.selectFrom('gl_fiscal_year').select(['id', 'code', 'start_date']).where('id', '=', fyId).where('company_id', '=', a.companyId).executeTakeFirst()
      : await fiscalYearOf(db, a.companyId, a.workDate ?? new Date().toISOString().slice(0, 10));
    if (!fy) return { fy: null, periods: [] };
    const periods = await db.selectFrom('gl_period').select(['id', 'period_no', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('start_date', '>=', fy.start_date).where('start_date', '<', addMonths(fy.start_date, 24)).orderBy('start_date').execute();
    return { fy, periods };
  }
  app.get('/api/v1/salespersons', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ status: z.enum(['A', 'I', 'all']).default('all') }), req.query);
    let s = db.selectFrom('md_salesperson as s').select(['s.id', 's.code', 's.name', 's.position', 's.salesperson_type', 's.sales_area_code', 's.commission_rate', 's.phone', 's.status',
      sql<number>`(SELECT count(*) FROM md_customer c WHERE c.salesperson_id = s.id AND c.deleted_at IS NULL)`.as('customer_count')])
      .where('s.company_id', '=', a.companyId).where('s.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('s.status', '=', q.status);
    return s.orderBy('s.code').execute();
  });
  app.get('/api/v1/salespersons/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(z.object({ fiscal_year_id: uuid.optional() }), req.query);
    const s = await db.selectFrom('md_salesperson').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('พนักงานขาย');
    const { fy, periods } = await targetPeriods(a, q.fiscal_year_id);
    const t = periods.length ? await db.selectFrom('md_sales_target').select(['period_id', 'target_amount']).where('company_id', '=', a.companyId).where('salesperson_id', '=', id).where('deleted_at', 'is', null).where('period_id', 'in', periods.map((p) => p.id)).execute() : [];
    const m = new Map(t.map((x) => [x.period_id, x.target_amount]));
    return { ...s, fiscal_year: fy, targets: periods.map((p, i) => ({ seq: i + 1, period_id: p.id, start_date: p.start_date, end_date: p.end_date, amount: d(m.get(p.id) ?? 0).toFixed(2) })) };
  });
  async function saveSlm(a: AuthContext & { companyId: string }, id: string | null, b: z.infer<typeof slmBody>) {
    const dup = await db.selectFrom('md_salesperson').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสพนักงานขาย ${b.code} มีอยู่แล้ว`);
    if (b.tax_id) { const c = checkTaxId(b.tax_id); if (!c.ok) throw badRequest(c.error!, [{ field: 'tax_id', message: c.error! }]); }
    if (b.commission_rate !== null && (b.commission_rate < 0 || b.commission_rate > 100)) throw badRequest('อัตราค่าคอมฯ ต้องอยู่ระหว่าง 0–100%');
    const { periods } = await targetPeriods(a, b.fiscal_year_id);
    const allowed = new Set(periods.map((p) => p.id));
    if (b.targets.some((t) => !allowed.has(t.period_id))) throw badRequest('งวดของเป้าการขายไม่อยู่ใน 24 งวดของปีที่เลือก');
    const { targets, fiscal_year_id: _fy, ...h } = b;
    const row = { ...h, tax_id: b.tax_id ? b.tax_id.replace(/[\s-]/g, '') : null, commission_rate: b.commission_rate === null ? null : String(b.commission_rate) };
    return db.transaction().execute(async (tx) => {
      let sid = id;
      if (id) {
        const r = await tx.updateTable('md_salesperson').set({ ...row, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!Number(r.numUpdatedRows)) throw notFound('พนักงานขาย');
      } else sid = (await tx.insertInto('md_salesperson').values({ ...row, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      if (periods.length) {
        await tx.updateTable('md_sales_target').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('salesperson_id', '=', sid!).where('period_id', 'in', periods.map((p) => p.id)).where('deleted_at', 'is', null).execute();
        const rows = targets.filter((t) => t.amount && t.amount > 0).map((t) => ({ company_id: a.companyId, salesperson_id: sid!, period_id: t.period_id, target_amount: d(t.amount).toFixed(2), created_by: a.userId }));
        if (rows.length) await tx.insertInto('md_sales_target').values(rows).execute();
      }
      await logActivity(tx, a, { module: 'SO', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'md_salesperson', rowId: sid });
      return { id: sid };
    });
  }
  app.post('/api/v1/salespersons', async (req) => saveSlm(requireCompany(req), null, parse(slmBody, req.body)));
  app.put('/api/v1/salespersons/:id', async (req) => saveSlm(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(slmBody, req.body)));
  app.delete('/api/v1/salespersons/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const s = await db.selectFrom('md_salesperson').select(['code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw notFound('พนักงานขาย');
    const used = await sql<{ n: number }>`SELECT (SELECT count(*) FROM doc_header WHERE salesperson_id = ${id} AND deleted_at IS NULL) + (SELECT count(*) FROM md_customer WHERE salesperson_id = ${id} AND deleted_at IS NULL) AS n`.execute(db);
    if (Number(used.rows[0]?.n ?? 0) > 0) throw badRequest(`พนักงานขาย ${s.code} มีลูกค้าหรือเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.updateTable('md_salesperson').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'SO', action: 'DELETE', docNo: s.code, table: 'md_salesperson', rowId: id });
    return { ok: true };
  });
}
