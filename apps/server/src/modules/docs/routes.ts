import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { notFound, parse, requireCompany } from '../../http.js';
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

  app.post('/api/v1/docs/:id/repost', async (req) => {
    const a = requireCompany(req);
    return repostDocument(db, a, parse(idParam, req.params).id);
  });
}
