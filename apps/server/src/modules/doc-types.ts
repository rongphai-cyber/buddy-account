import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { checkDocNumbering, DOC_CLASSES, DOC_SLOT_ROLES, GL_ROLES, JOURNAL_ROUTES } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';
import { checkAccount } from './parties.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const lvl = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 9), 'ระดับ 0–9');

/* ------------------------------------------------------------------ ประเภทเอกสาร / เลขที่เอกสาร S-DN-01 / S-DN-02 */
const docTypeBody = z.object({
  code: z.string().trim().min(1, 'ป้อนตัวนำหน้าเลขที่ (prefix)').max(4).transform((v) => v.toUpperCase()),
  doc_class: z.string().trim().refine((v) => v in DOC_CLASSES, 'เลือกหมวดเอกสาร'),
  name_th: z.string().trim().min(1, 'ป้อนชื่อเอกสาร').max(120), name_en: str(120), short_name: str(10),
  next_no: z.union([z.number(), z.string()]).transform(String),
  journal_book_id: optId, department_id: optId, warehouse_id: optId, journal_desc_template: str(200),
  price_type: z.enum(['', '0', '1', '2']).nullable().optional().transform((v) => v || null),
  vat_rate: z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : String(v))),
  vat_basis: z.enum(['', '1', '2', '3']).nullable().optional().transform((v) => v || null), vat_per_line: z.boolean().default(false),
  approve_level: lvl, approve_method: z.enum(['', '1', '2']).nullable().optional().transform((v) => v || null), reprint_level: lvl, cancel_level: lvl, delete_level: lvl, over_limit_level: lvl,
  auto_print: z.boolean().default(false), form_no: z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : Number(v))),
  use_barcode: z.boolean().default(false), status: z.enum(['A', 'I']).default('A'),
  accounts: z.array(z.object({ slot: z.number().int().min(1).max(12), account_id: uuid })).max(12).default([]),
});

export function docTypeRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/doc-types', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_doc_type as t').leftJoin('gl_journal_book as b', 'b.id', 't.journal_book_id').leftJoin('md_department as d', 'd.id', 't.department_id')
      .select(['t.id', 't.code', 't.doc_class', 't.module', 't.name_th', 't.name_en', 't.next_no', 't.status', 'b.code as book_code', 'b.name_th as book_name', 'd.code as department_code',
        sql<number>`(SELECT count(*) FROM doc_header h WHERE h.doc_type_id = t.id AND h.deleted_at IS NULL)`.as('doc_count'),
        sql<number>`(SELECT count(*) FROM md_doc_type_account x WHERE x.doc_type_id = t.id AND x.deleted_at IS NULL)`.as('account_count')])
      .where('t.company_id', '=', a.companyId).where('t.deleted_at', 'is', null).orderBy('t.doc_class').orderBy('t.code').execute();
  });
  app.get('/api/v1/doc-types/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const t = await db.selectFrom('md_doc_type').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ประเภทเอกสาร');
    const accounts = await db.selectFrom('md_doc_type_account as x').innerJoin('gl_account as g', 'g.id', 'x.account_id').select(['x.slot', 'x.role', 'x.account_id', 'g.account_no', 'g.name_th'])
      .where('x.doc_type_id', '=', id).where('x.deleted_at', 'is', null).orderBy('x.slot').execute();
    const docs = await db.selectFrom('doc_header').select([sql<number>`count(*)`.as('n'), sql<string | null>`max(doc_no)`.as('last_no')]).where('company_id', '=', a.companyId).where('doc_type_id', '=', id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    return { ...t, accounts, doc_count: Number(docs.n), last_doc_no: docs.last_no };
  });

  async function save(a: Ctx, id: string | null, b: z.infer<typeof docTypeBody>) {
    if (id && !(await db.selectFrom('md_doc_type').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw notFound('ประเภทเอกสาร');
    const bad = checkDocNumbering(b.code, b.next_no);
    if (bad) throw badRequest(bad, [{ field: /เลขที่ถัดไป|หลัก/.test(bad) ? 'next_no' : 'code', message: bad }]);
    const dup = await db.selectFrom('md_doc_type').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`ตัวนำหน้า ${b.code} ใช้กับประเภทเอกสารอื่นแล้ว — เลขที่เอกสารต้องไม่ซ้ำกัน`);
    for (const [t, col, label] of [['gl_journal_book', b.journal_book_id, 'สมุดรายวัน'], ['md_department', b.department_id, 'แผนก'], ['md_warehouse', b.warehouse_id, 'คลังสินค้า']] as const)
      if (col && !(await db.selectFrom(t).select('id').where('id', '=', col).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest(`ไม่พบ${label}ที่เลือก`);
    const slots = new Set<number>();
    for (const x of b.accounts) { if (slots.has(x.slot)) throw badRequest(`ช่องบัญชีที่ ${x.slot} ซ้ำ`); slots.add(x.slot); await checkAccount(db, a.companyId, x.account_id, `accounts.${x.slot}`); }
    if (b.vat_rate !== null && (Number.isNaN(Number(b.vat_rate)) || Number(b.vat_rate) < 0 || Number(b.vat_rate) > 30)) throw badRequest('อัตราภาษี 0–30%');
    // เลขที่ถัดไปต้องไม่ย้อนไปชนเลขที่ใช้แล้ว (คู่มือหน้า 152: นำเลขกลับมาใช้อาจชนเอกสารที่ค้าง)
    if (id) {
      const used = await sql<{ n: number }>`SELECT count(*) AS n FROM doc_header WHERE company_id = ${a.companyId} AND doc_type_id = ${id} AND deleted_at IS NULL AND doc_no = ${b.code + b.next_no.replace(/^0+/, '').padStart(7, '0')}`.execute(db);
      if (Number(used.rows[0]?.n)) throw badRequest(`เลขที่ ${b.code}${b.next_no.replace(/^0+/, '').padStart(7, '0')} ใช้กับเอกสารแล้ว — ตั้งเลขที่ถัดไปให้มากกว่าเลขล่าสุด`, [{ field: 'next_no', message: 'ซ้ำกับเอกสารที่มีอยู่' }]);
    }
    const { accounts, ...row } = b;
    const values = { ...row, next_no: Number(row.next_no), module: DOC_CLASSES[b.doc_class]!.module, is_tax_invoice: ['IV', 'HS', 'DR', 'CN', 'AI', 'RE'].includes(b.doc_class) };
    return db.transaction().execute(async (tx) => {
      let tid = id;
      if (id) {
        const cur = await tx.selectFrom('md_doc_type').select(['doc_class']).where('id', '=', id).executeTakeFirstOrThrow();
        const hasDocs = await tx.selectFrom('doc_header').select('id').where('doc_type_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
        if (hasDocs && cur.doc_class !== b.doc_class) throw badRequest('ประเภทเอกสารนี้มีเอกสารแล้ว เปลี่ยนหมวดเอกสารไม่ได้');
        await tx.updateTable('md_doc_type').set({ ...values, updated_by: a.userId }).where('id', '=', id).execute();
      } else tid = (await tx.insertInto('md_doc_type').values({ ...values, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      await tx.updateTable('md_doc_type_account').set({ deleted_at: sql`now()` as never }).where('doc_type_id', '=', tid!).where('deleted_at', 'is', null).execute();
      if (accounts.length) await tx.insertInto('md_doc_type_account').values(accounts.map((x) => ({ company_id: a.companyId, doc_type_id: tid!, slot: x.slot, role: DOC_SLOT_ROLES[b.doc_class]?.[x.slot] ?? null, account_id: x.account_id, created_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'SET', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'md_doc_type', rowId: tid });
      return { id: tid };
    });
  }
  app.post('/api/v1/doc-types', async (req) => save(requireCompany(req), null, parse(docTypeBody, req.body)));
  app.put('/api/v1/doc-types/:id', async (req) => save(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(docTypeBody, req.body)));
  app.delete('/api/v1/doc-types/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const t = await db.selectFrom('md_doc_type').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ประเภทเอกสาร');
    if (await db.selectFrom('doc_header').select('id').where('doc_type_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()) throw badRequest(`ประเภทเอกสาร ${t.code} มีเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_doc_type_account').set({ deleted_at: sql`now()` as never }).where('doc_type_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('md_doc_type').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'SET', action: 'DELETE', docNo: t.code, table: 'md_doc_type', rowId: id });
    });
    return { ok: true };
  });

  /* ------------------------------------------------------------------ การเชื่อมต่อบัญชี S-GL-01 / S-GL-02 */
  app.get('/api/v1/gl/link', async (req) => {
    const a = requireCompany(req);
    const s = await companySettings(db, a.companyId);
    const routes = await db.selectFrom('gl_journal_route').select(['txn_kind', 'journal_book_id']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
    const defaults = await db.selectFrom('gl_default_account as d').innerJoin('gl_account as g', 'g.id', 'd.account_id').select(['d.role', 'd.account_id', 'g.account_no', 'g.name_th'])
      .where('d.company_id', '=', a.companyId).where('d.deleted_at', 'is', null).execute();
    return { link_gl: s['gen.link_gl'] !== false, routes, defaults };
  });
  const linkBody = z.object({
    link_gl: z.boolean(),
    routes: z.array(z.object({ txn_kind: z.string().refine((k) => JOURNAL_ROUTES.some((r) => r.kind === k), 'ประเภทรายการไม่ถูกต้อง'), journal_book_id: optId })).max(60).default([]),
    defaults: z.array(z.object({ role: z.string().refine((r) => GL_ROLES.some((g) => g.role === r), 'บทบาทบัญชีไม่ถูกต้อง'), account_id: optId })).max(60).default([]),
  });
  app.put('/api/v1/gl/link', async (req) => {
    const a = requireCompany(req);
    const b = parse(linkBody, req.body);
    for (const r of b.routes) if (r.journal_book_id && !(await db.selectFrom('gl_journal_book').select('id').where('id', '=', r.journal_book_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบสมุดรายวันที่เลือก');
    for (const x of b.defaults) await checkAccount(db, a.companyId, x.account_id, `defaults.${x.role}`);
    for (const role of ['SUSPENSE', 'RETAINED_EARNINGS']) {
      const x = b.defaults.find((d) => d.role === role);
      if (x && !x.account_id) throw badRequest(`ต้องกำหนดบัญชี${role === 'SUSPENSE' ? 'พัก' : 'กำไรสะสม'} (ใช้ในการลงบัญชีอัตโนมัติและปิดบัญชีสิ้นปี)`);
    }
    await db.transaction().execute(async (tx) => {
      await setSetting(tx, a.companyId, 'gen.link_gl', b.link_gl);
      for (const r of b.routes) {
        await tx.updateTable('gl_journal_route').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('txn_kind', '=', r.txn_kind).where('deleted_at', 'is', null).execute();
        if (r.journal_book_id) await tx.insertInto('gl_journal_route').values({ company_id: a.companyId, txn_kind: r.txn_kind, journal_book_id: r.journal_book_id, created_by: a.userId }).execute();
      }
      for (const x of b.defaults) {
        await tx.updateTable('gl_default_account').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('role', '=', x.role).where('deleted_at', 'is', null).execute();
        if (x.account_id) await tx.insertInto('gl_default_account').values({ company_id: a.companyId, role: x.role, account_id: x.account_id, created_by: a.userId }).execute();
      }
      await logActivity(tx, a, { module: 'SET', action: 'EDIT', docNo: 'การเชื่อมต่อบัญชี', table: 'gl_default_account', detail: { link_gl: b.link_gl, routes: b.routes.length, defaults: b.defaults.length } });
    });
    return { ok: true };
  });
}
