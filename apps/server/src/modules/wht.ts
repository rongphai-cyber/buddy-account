import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { periodFor } from './gl/journals.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');

const entry = z.object({
  form_type: z.enum(['S03', 'S53'], { errorMap: () => ({ message: 'เลือกแบบ ภ.ง.ด.3 หรือ ภ.ง.ด.53' }) }),
  certificate_no: str(30), certificate_date: isoDate, is_late: z.boolean().default(false),
  supplier_id: uuid.nullable().optional().transform((v) => v ?? null),
  payee_name: z.string().trim().min(1, 'ป้อนชื่อผู้ถูกหักภาษี').max(200), payee_address: str(500), payee_tax_id: str(13), payee_tax_branch_no: str(5),
  income_type: z.string().trim().min(1, 'ป้อนประเภทเงินได้').max(60), condition: z.enum(['1', '2', '3']).default('1'),
  paid_amount: num, rate: num, tax_amount: num,
});

/** แฟ้มภาษีหัก ณ ที่จ่าย (คู่มือบทที่ 16 S-TX-09/10) — รายการเกิดจากใบสำคัญจ่าย หรือเพิ่มเองในแฟ้ม */
export function whtRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/wht', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ form: z.enum(['S03', 'S53', 'all']).default('all'), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), q: z.string().optional(),
      status: z.enum(['N', 'C', 'all']).default('N'), limit: z.coerce.number().int().min(1).max(2000).default(500) }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql.join([
      sql`w.company_id = ${a.companyId}`, sql`w.deleted_at IS NULL`,
      ...(q.form !== 'all' ? [sql`w.form_type = ${q.form}`] : []), ...(q.status !== 'all' ? [sql`w.doc_status = ${q.status}`] : []),
      ...(q.month ? [sql`to_char(p.start_date, 'YYYY-MM') = ${q.month}`] : []),
      ...(like ? [sql`(w.payee_name ILIKE ${like} OR w.certificate_no ILIKE ${like} OR h.doc_no ILIKE ${like} OR w.payee_tax_id ILIKE ${like})`] : []),
    ], sql` AND `);
    const rows = (await sql`SELECT w.id, w.form_type, w.certificate_no, w.certificate_date, to_char(p.start_date, 'YYYY-MM') AS tax_month, w.is_late, w.payee_name, w.payee_tax_id,
        w.income_type, w.paid_amount, w.rate, w.tax_amount, w.condition, w.doc_status, w.print_count, h.id AS header_id, h.doc_no, h.doc_class
      FROM tax_wht_entry w JOIN gl_period p ON p.id = w.tax_period_id LEFT JOIN doc_header h ON h.id = w.header_id
      WHERE ${where} ORDER BY w.certificate_date, w.certificate_no, w.created_at LIMIT ${q.limit}`.execute(db)).rows as Array<{ paid_amount: string; tax_amount: string }>;
    const sum = (k: 'paid_amount' | 'tax_amount') => rows.reduce((s, r) => s.plus(d(r[k])), d(0)).toFixed(2);
    return { rows, total_paid: sum('paid_amount'), total_tax: sum('tax_amount') };
  });
  /**
   * ไฟล์ยื่นแบบทางอินเทอร์เน็ต ภ.ง.ด.3/53 (ข้อความคั่นด้วย | หนึ่งบรรทัดต่อผู้มีเงินได้) สำหรับนำเข้าโปรแกรมของกรมสรรพากร
   * ภ.ง.ด.3: ลำดับ|เลขประจำตัว|สาขา|คำนำหน้า|ชื่อ|นามสกุล|ที่อยู่|วันที่จ่าย(ววดดปปปป พ.ศ.)|ประเภทเงินได้|อัตรา|จำนวนเงิน|ภาษี|เงื่อนไข
   * ภ.ง.ด.53: ลำดับ|เลขประจำตัว|สาขา|คำนำหน้า|ชื่อ|ที่อยู่|วันที่จ่าย|ประเภทเงินได้|อัตรา|จำนวนเงิน|ภาษี|เงื่อนไข
   */
  app.get('/api/v1/wht/efile', async (req, reply) => {
    const a = requireCompany(req);
    const q = parse(z.object({ form: z.enum(['S03', 'S53']), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'เลือกเดือนภาษี'), late: z.enum(['Y', 'N']).default('N') }), req.query);
    const rows = (await sql<{ payee_tax_id: string | null; payee_tax_branch_no: string | null; payee_name: string; payee_address: string | null; certificate_date: string; income_type: string; rate: string; paid_amount: string; tax_amount: string; condition: string }>`
      SELECT w.payee_tax_id, w.payee_tax_branch_no, w.payee_name, w.payee_address, w.certificate_date, w.income_type, w.rate, w.paid_amount, w.tax_amount, w.condition
        FROM tax_wht_entry w JOIN gl_period p ON p.id = w.tax_period_id
       WHERE w.company_id = ${a.companyId} AND w.deleted_at IS NULL AND w.doc_status <> 'C' AND w.form_type = ${q.form} AND to_char(p.start_date, 'YYYY-MM') = ${q.month} AND w.is_late = ${q.late === 'Y'}
       ORDER BY w.certificate_date, w.certificate_no`.execute(db)).rows;
    if (!rows.length) throw badRequest('ไม่มีรายการภาษีหัก ณ ที่จ่ายของงวดนี้');
    const TITLES = ['นางสาว', 'นาง', 'นาย', 'น.ส.', 'บริษัท', 'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญ', 'หจก.', 'บจก.'];
    const clean = (v: string | null | undefined) => (v ?? '').replace(/[|\r\n]+/g, ' ').trim();
    const lines = rows.map((r, i) => {
      const name = clean(r.payee_name);
      const title = TITLES.find((t) => name.startsWith(t)) ?? '';
      const rest = name.slice(title.length).trim();
      const [dd, mm, yy] = [r.certificate_date.slice(8, 10), r.certificate_date.slice(5, 7), String(Number(String(r.certificate_date).slice(0, 4)) + 543)];
      const nameCols = q.form === 'S03' ? [rest.split(/\s+/)[0] ?? '', rest.split(/\s+/).slice(1).join(' ')] : [rest];
      return [i + 1, clean(r.payee_tax_id), (r.payee_tax_branch_no ?? '00000').padStart(5, '0'), title, ...nameCols, clean(r.payee_address), `${dd}${mm}${yy}`, clean(r.income_type),
        d(r.rate).toFixed(2), d(r.paid_amount).toFixed(2), d(r.tax_amount).toFixed(2), r.condition || '1'].join('|');
    });
    const fname = `${q.form === 'S03' ? 'PND3' : 'PND53'}_${q.month.replace('-', '')}${q.late === 'Y' ? '_ADD' : ''}.txt`;
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${fname}"`);
    return lines.join('\r\n') + '\r\n';
  });
  /** รายการเดียว + รายการอื่นของเอกสารเดียวกัน แบบเดียวกัน (พิมพ์รวมในหนังสือรับรองฉบับเดียว) */
  app.get('/api/v1/wht/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const w = await db.selectFrom('tax_wht_entry as w').leftJoin('doc_header as h', 'h.id', 'w.header_id').selectAll('w').select(['h.doc_no', 'h.doc_class'])
      .where('w.id', '=', id).where('w.company_id', '=', a.companyId).where('w.deleted_at', 'is', null).executeTakeFirst();
    if (!w) throw notFound('รายการภาษีหัก ณ ที่จ่าย');
    const lines = w.header_id ? await db.selectFrom('tax_wht_entry').select(['id', 'income_type', 'rate', 'paid_amount', 'tax_amount', 'certificate_date'])
      .where('company_id', '=', a.companyId).where('header_id', '=', w.header_id).where('form_type', '=', w.form_type).where('doc_status', '=', 'N').where('deleted_at', 'is', null).orderBy('created_at').execute()
      : [{ id: w.id, income_type: w.income_type, rate: w.rate, paid_amount: w.paid_amount, tax_amount: w.tax_amount, certificate_date: w.certificate_date }];
    return { ...w, lines };
  });
  const save = async (a: ReturnType<typeof requireCompany>, id: string | null, b: z.infer<typeof entry>) => {
    if (d(b.paid_amount).lte(0)) throw badRequest('ป้อนจำนวนเงินที่จ่าย');
    if (d(b.tax_amount).lt(0) || d(b.rate).lt(0) || d(b.rate).gt(100)) throw badRequest('อัตราหรือภาษีที่หักไม่ถูกต้อง');
    if (b.payee_tax_id && ![10, 13].includes(b.payee_tax_id.replace(/\D/g, '').length)) throw badRequest('เลขผู้เสียภาษีของผู้ถูกหักต้องเป็น 13 หลัก');
    if (b.supplier_id && !(await db.selectFrom('md_supplier').select('id').where('id', '=', b.supplier_id).where('company_id', '=', a.companyId).executeTakeFirst())) throw badRequest('ไม่พบผู้จำหน่ายนี้');
    return db.transaction().execute(async (tx) => {
      const per = await periodFor(tx, a.companyId, b.certificate_date);
      const vals = { ...b, tax_period_id: per.id, paid_amount: d(b.paid_amount).toFixed(2), tax_amount: d(b.tax_amount).toFixed(2), updated_by: a.userId };
      let rowId = id;
      if (id) {
        const cur = await tx.selectFrom('tax_wht_entry').select(['header_id', 'doc_status', 'paid_amount', 'tax_amount', 'form_type']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!cur) throw notFound('รายการภาษีหัก ณ ที่จ่าย');
        if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
        // รายการจากใบสำคัญจ่าย: ยอดเงินผูกกับการลงบัญชี — แก้ที่เอกสารต้นทาง
        if (cur.header_id && (!d(cur.paid_amount).eq(d(b.paid_amount)) || !d(cur.tax_amount).eq(d(b.tax_amount))))
          throw badRequest('ยอดเงินของรายการที่มาจากใบสำคัญจ่าย แก้ที่เอกสารต้นทาง (จ่ายชำระหนี้)');
        await tx.updateTable('tax_wht_entry').set(vals).where('id', '=', id).execute();
      } else {
        const branch = a.branchId ?? (await tx.selectFrom('sys_branch').select('id').where('company_id', '=', a.companyId).where('is_head_office', '=', true).executeTakeFirstOrThrow()).id;
        rowId = (await tx.insertInto('tax_wht_entry').values({ ...vals, company_id: a.companyId, branch_id: branch, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      }
      await logActivity(tx, a, { module: 'TAX', action: id ? 'EDIT' : 'ADD', docNo: b.certificate_no ?? b.payee_name, table: 'tax_wht_entry', rowId });
      return { id: rowId };
    });
  };
  app.post('/api/v1/wht', async (req) => save(requireCompany(req), null, parse(entry, req.body)));
  app.put('/api/v1/wht/:id', async (req) => save(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(entry, req.body)));
  /** ยกเลิกรายการที่เพิ่มเองในแฟ้ม (รายการจากใบสำคัญจ่าย ยกเลิกพร้อมเอกสาร) */
  app.post('/api/v1/wht/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await db.selectFrom('tax_wht_entry').select(['header_id', 'doc_status', 'certificate_no', 'payee_name']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('รายการภาษีหัก ณ ที่จ่าย');
    if (cur.header_id) throw badRequest('รายการนี้มาจากใบสำคัญจ่าย — ยกเลิกที่เอกสารต้นทาง');
    if (cur.doc_status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('tax_wht_entry').set({ doc_status: 'C', updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'TAX', action: 'CANCEL', docNo: cur.certificate_no ?? cur.payee_name, table: 'tax_wht_entry', rowId: id });
    });
    return { ok: true };
  });
  /** นับจำนวนครั้งที่พิมพ์หนังสือรับรอง (50 ทวิ) */
  app.post('/api/v1/wht/:id/printed', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const r = await db.updateTable('tax_wht_entry').set({ print_count: sql`print_count + 1` as never }).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('รายการภาษีหัก ณ ที่จ่าย');
    return { ok: true };
  });
}
