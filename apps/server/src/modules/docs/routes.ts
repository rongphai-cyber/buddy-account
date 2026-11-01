import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { deleteDocument, previewPosting, repostDocument } from './engine.js';
import { deleteJournal } from '../gl/journals.js';

const idParam = z.object({ id: z.string().uuid() });

/** ใบสำคัญที่เกิดจากเอกสาร · ตัวอย่างการลงบัญชี · ลงบัญชีใหม่รายเอกสาร (เริ่มระบบ 5.4) */
export function docRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/docs/:id/journal', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(idParam, req.params);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_no', 'doc_status', 'gl_posted', 'journal_id']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    const journals = await db.selectFrom('gl_journal as j').innerJoin('gl_journal_book as b', 'b.id', 'j.journal_book_id')
      .select(['j.id', 'j.voucher_no', 'j.voucher_date', 'j.description', 'j.doc_status', 'j.total_debit', 'b.code as book_code', 'b.name_th as book_name'])
      .where('j.company_id', '=', a.companyId).where('j.source_header_id', '=', id).where('j.deleted_at', 'is', null).orderBy('j.created_at').execute();
    const lines = journals.length ? await db.selectFrom('gl_journal_line as l').innerJoin('gl_account as g', 'g.id', 'l.account_id')
      .select(['l.journal_id', 'l.line_no', 'g.account_no', 'g.name_th as account_name', 'l.debit', 'l.credit', 'l.posting_role', 'l.resolved_from'])
      .where('l.journal_id', 'in', journals.map((j) => j.id)).where('l.deleted_at', 'is', null).orderBy('l.journal_id').orderBy('l.line_no').execute() : [];
    return { doc: h, journals: journals.map((j) => ({ ...j, lines: lines.filter((l) => l.journal_id === j.id) })) };
  });

  app.get('/api/v1/docs/:id/posting-preview', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(idParam, req.params);
    const pv = await previewPosting(db, a.companyId, id);
    if (!pv) throw notFound('เอกสาร (หรือหมวดเอกสารนี้ไม่ลงบัญชี)');
    const accs = new Map((await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th']).where('company_id', '=', a.companyId).where('id', 'in', [...new Set(pv.lines.map((l) => l.account_id).filter((x): x is string => !!x)), '00000000-0000-0000-0000-000000000000']).execute()).map((x) => [x.id, x]));
    return pv.lines.map((l) => ({ account_id: l.account_id, account_no: l.account_id ? accs.get(l.account_id)?.account_no : null, account_name: l.account_id ? accs.get(l.account_id)?.name_th : null,
      debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), role: l.role, layer: l.layer }));
  });

  /** ปุ่ม "ลบ" ทุกหน้าจอเอกสาร/ใบสำคัญ (ต้องยกเลิกก่อน) — สิทธิ์ "ลบ" ตามเมนูของเอกสาร */
  app.post('/api/v1/docs/:kind/:id/delete', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ kind: z.enum(['doc', 'journal']), id: z.string().uuid() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ระบุเหตุผลที่ลบ').max(200) }), req.body);
    return p.kind === 'doc' ? deleteDocument(db, a, p.id, reason) : deleteJournal(db, a, p.id, reason);
  });

  /** เลขที่/วันที่หนังสือรับรอง 50 ทวิ ที่ผู้จ่ายเงินออกให้ (ทะเบียนภาษีถูกหัก 6.8) — บันทึกภายหลังได้ ไม่กระทบการลงบัญชี */
  app.put('/api/v1/docs/:kind/:id/wht-cert', async (req) => {
    const a = requireCompany(req);
    const { kind, id } = parse(z.object({ kind: z.literal('doc'), id: z.string().uuid() }), req.params);
    const b = parse(z.object({ cert_no: z.string().trim().max(30).nullable().optional().transform((v) => v || null), cert_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null) }), req.body);
    const h = await db.selectFrom('doc_header').select(['doc_no', 'doc_class', 'doc_status', 'wht_amount', 'module', 'wht_cert_no', 'wht_cert_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (!['HS', 'RE', 'AI', 'OI', 'BU'].includes(h.doc_class) || Number(h.wht_amount) === 0) throw badRequest('เอกสารนี้ไม่มีภาษีถูกหัก ณ ที่จ่าย');
    if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
    if (b.cert_date && !b.cert_no) throw badRequest('ป้อนเลขที่หนังสือรับรอง 50 ทวิ', [{ field: 'cert_no', message: 'ป้อนเลขที่' }]);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('doc_header').set({ wht_cert_no: b.cert_no, wht_cert_date: b.cert_date, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: h.module ?? kind, action: 'WHT_CERT', docNo: h.doc_no, table: 'doc_header', rowId: id, detail: { before: { cert_no: h.wht_cert_no, cert_date: h.wht_cert_date }, after: b } });
      return { ok: true };
    });
  });

  app.post('/api/v1/docs/:id/repost', async (req) => {
    const a = requireCompany(req);
    return repostDocument(db, a, parse(idParam, req.params).id);
  });
}
