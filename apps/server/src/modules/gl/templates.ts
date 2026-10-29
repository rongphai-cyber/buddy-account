import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, conflict, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';

const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).nullable().optional();

/** ต้นแบบวิธีการบันทึก — คู่มือบทที่ 15 S-GL-01 (สร้าง/แก้) และ S-GL-05 (เลือกต้นแบบในใบสำคัญ) */
export function templateRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/gl/templates', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('gl_template as t')
      .select(['t.id', 't.code', 't.name', 't.name_en',
        sql<number>`(SELECT count(*) FROM gl_template_line l WHERE l.template_id = t.id AND l.deleted_at IS NULL)`.as('line_count'),
        sql<string | null>`(SELECT string_agg(b.code, ', ' ORDER BY b.code) FROM gl_journal_book b WHERE b.template_id = t.id AND b.deleted_at IS NULL)`.as('book_codes')])
      .where('t.company_id', '=', a.companyId).where('t.deleted_at', 'is', null).orderBy('t.code').execute();
  });

  app.get('/api/v1/gl/templates/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const t = await db.selectFrom('gl_template').select(['id', 'code', 'name', 'name_en']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw notFound('ต้นแบบวิธีการบันทึก');
    const lines = await db.selectFrom('gl_template_line as l').leftJoin('gl_account as g', 'g.id', 'l.account_id').leftJoin('md_department as dp', 'dp.id', 'l.department_id')
      .select(['l.line_no', 'l.account_id', 'g.account_no', 'g.name_th as account_name', 'l.department_id', 'dp.code as department_code', 'l.description', 'l.side', 'l.amount'])
      .where('l.template_id', '=', id).where('l.company_id', '=', a.companyId).where('l.deleted_at', 'is', null).orderBy('l.line_no').execute();
    return { ...t, lines };
  });

  const body = z.object({
    code: z.string().trim().min(1, 'ป้อนรหัสต้นแบบ').max(10, 'รหัสต้นแบบยาวไม่เกิน 10 ตัวอักษร'),
    name: z.string().trim().min(1, 'ป้อนรายละเอียดต้นแบบ').max(120),
    name_en: z.string().trim().max(120).nullable().optional(),
    lines: z.array(z.object({
      account_id: uuid.nullable(), department_id: uuid.nullable().optional(), description: z.string().trim().max(120).nullable().optional(),
      side: z.enum(['D', 'C'], { errorMap: () => ({ message: 'เลือกเดบิตหรือเครดิต' }) }), amount: money,
    })).min(1, 'ป้อนรายการบัญชีอย่างน้อย 1 บรรทัด').max(999),
  });

  /** ตรวจบรรทัด: บัญชีต้องเป็นบัญชีย่อยที่ใช้งานในบริษัทนี้ แผนกต้องเป็นของบริษัทนี้ จำนวนเงินว่างได้แต่ห้ามติดลบ */
  async function checkLines(companyId: string, lines: z.infer<typeof body>['lines']) {
    const accIds = [...new Set(lines.map((l) => l.account_id).filter((x): x is string => !!x))];
    const depIds = [...new Set(lines.map((l) => l.department_id).filter((x): x is string => !!x))];
    const accts = accIds.length ? await db.selectFrom('gl_account').select(['id', 'account_no', 'is_control', 'status']).where('company_id', '=', companyId).where('id', 'in', accIds).where('deleted_at', 'is', null).execute() : [];
    const deps = depIds.length ? await db.selectFrom('md_department').select('id').where('company_id', '=', companyId).where('id', 'in', depIds).where('deleted_at', 'is', null).execute() : [];
    const accById = new Map(accts.map((x) => [x.id, x]));
    const depSet = new Set(deps.map((x) => x.id));
    const issues: Array<{ line: number; field: string; message: string }> = [];
    lines.forEach((l, i) => {
      const acc = l.account_id ? accById.get(l.account_id) : undefined;
      if (!l.account_id) issues.push({ line: i, field: 'account_id', message: `บรรทัด ${i + 1}: ป้อนเลขที่บัญชี` });
      else if (!acc) issues.push({ line: i, field: 'account_id', message: `บรรทัด ${i + 1}: ไม่พบบัญชีนี้ในผังบัญชี` });
      else if (acc.is_control) issues.push({ line: i, field: 'account_id', message: `บรรทัด ${i + 1}: บัญชี ${acc.account_no} เป็นบัญชีคุม ให้ใช้บัญชีย่อย` });
      else if (acc.status !== 'A') issues.push({ line: i, field: 'account_id', message: `บรรทัด ${i + 1}: บัญชี ${acc.account_no} เลิกใช้แล้ว` });
      if (l.department_id && !depSet.has(l.department_id)) issues.push({ line: i, field: 'department_id', message: `บรรทัด ${i + 1}: ไม่พบแผนกนี้` });
      if (d(l.amount).isNegative()) issues.push({ line: i, field: 'amount', message: `บรรทัด ${i + 1}: จำนวนเงินติดลบไม่ได้ (เลือกเดบิต/เครดิตแทน)` });
    });
    if (issues.length) throw badRequest(issues[0]!.message, issues);
  }

  async function checkCode(companyId: string, code: string, selfId?: string) {
    const dup = await db.selectFrom('gl_template').select('id').where('company_id', '=', companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== selfId) throw conflict(`รหัสต้นแบบ ${code} มีอยู่แล้ว`);
  }

  async function writeLines(tx: Db, companyId: string, templateId: string, userId: string, lines: z.infer<typeof body>['lines']) {
    // บรรทัดเดิมทำเครื่องหมายลบ (ไม่ลบจริง เพื่อให้ sync ส่งการลบไปเครื่องลูกได้) แล้วเขียนชุดใหม่
    await tx.updateTable('gl_template_line').set({ deleted_at: sql`now()` as never }).where('template_id', '=', templateId).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute();
    await tx.insertInto('gl_template_line').values(lines.map((l, i) => ({
      company_id: companyId, template_id: templateId, line_no: i + 1, account_id: l.account_id, department_id: l.department_id ?? null,
      description: l.description || null, side: l.side, amount: d(l.amount).isZero() ? null : d(l.amount).toFixed(2), created_by: userId,
    }))).execute();
  }

  app.post('/api/v1/gl/templates', async (req) => {
    const a = requireCompany(req);
    const b = parse(body, req.body);
    await checkCode(a.companyId, b.code);
    await checkLines(a.companyId, b.lines);
    return db.transaction().execute(async (tx) => {
      const r = await tx.insertInto('gl_template').values({ company_id: a.companyId, code: b.code, name: b.name, name_en: b.name_en || null, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await writeLines(tx, a.companyId, r.id, a.userId, b.lines);
      await logActivity(tx, a, { module: 'GL', action: 'ADD', docNo: b.code, table: 'gl_template', rowId: r.id, detail: { lines: b.lines.length } });
      return r;
    });
  });

  app.put('/api/v1/gl/templates/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(body, req.body);
    const cur = await db.selectFrom('gl_template').select(['id', 'code', 'name', 'name_en']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('ต้นแบบวิธีการบันทึก');
    await checkCode(a.companyId, b.code, id);
    await checkLines(a.companyId, b.lines);
    const before = await db.selectFrom('gl_template_line').select(['line_no', 'account_id', 'department_id', 'description', 'side', 'amount']).where('template_id', '=', id).where('deleted_at', 'is', null).orderBy('line_no').execute();
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('gl_template').set({ code: b.code, name: b.name, name_en: b.name_en || null, updated_by: a.userId }).where('id', '=', id).execute();
      await writeLines(tx, a.companyId, id, a.userId, b.lines);
      await logActivity(tx, a, { module: 'GL', action: 'EDIT', docNo: b.code, table: 'gl_template', rowId: id, detail: { before: { ...cur, lines: before } } });
      return { id };
    });
  });

  /** ลบต้นแบบ — ไม่กระทบใบสำคัญที่เคยใช้ต้นแบบนี้ (คัดลอกบรรทัดไปแล้ว) แต่ถ้าสมุดรายวันผูกไว้ต้องเอาออกก่อน */
  app.delete('/api/v1/gl/templates/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await db.selectFrom('gl_template').select(['code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('ต้นแบบวิธีการบันทึก');
    const book = await db.selectFrom('gl_journal_book').select('code').where('template_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (book) throw badRequest(`ต้นแบบนี้ผูกกับสมุดรายวัน ${book.code} อยู่ — เอาออกที่เมนู บัญชี › สร้างสมุดรายวัน ก่อนลบ`);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('gl_template_line').set({ deleted_at: sql`now()` as never }).where('template_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('gl_template').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'GL', action: 'DELETE', docNo: cur.code, table: 'gl_template', rowId: id });
    });
    return { ok: true };
  });
}
