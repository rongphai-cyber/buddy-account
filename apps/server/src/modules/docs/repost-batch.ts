import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, netByAccount, type Decimal } from '@buddy/core';
import type { Db } from '../../db.js';
import { parse, requireCompany } from '../../http.js';
import { previewPosting, repostDocument } from './engine.js';

/**
 * ลงบัญชีใหม่ให้เอกสารที่ลงไว้ก่อน 17/11/2569 (HANDOFF 126 · เจ้าของตอบ "ลงบัญชีใหม่")
 * เดิม engine ลงแผนกที่หัวเอกสารทุกบรรทัด และไม่ใส่รายละเอียดบรรทัด (เงินสดย่อย/เอกสารธนาคาร) → แผนกของบรรทัดหาย รายงานรายแผนกไม่นับ
 * เลือกเฉพาะเอกสารที่ลงใหม่แล้วจะต่าง: บรรทัดเอกสารมีแผนกต่างจากหัว แต่ใบสำคัญไม่มีบรรทัดแผนกนั้น · หรือบรรทัดบัญชีมีรายละเอียด แต่ใบสำคัญไม่มีคำอธิบายนั้น
 * ความปลอดภัย: ลงใหม่เฉพาะเมื่อยอดสุทธิรายบัญชีของการลงใหม่ = ใบสำคัญเดิมทุกบัญชี (เปลี่ยนแค่แผนก/คำอธิบาย) · ไม่ตรง = ข้ามและแจ้ง
 * ใช้ repostDocument เดิม (ทรานแซกชันต่อใบ · ใบสำคัญเดิม เลขที่เดิม บรรทัดเก่าเก็บเป็นประวัติ · บันทึก sys_activity_log REPOST) · งวดที่ปิดแล้วลงใหม่ไม่ได้ (แจ้งเป็นรายใบ)
 */
const CLASSES = ['IV', 'DR', 'HS', 'CN', 'RR', 'CP', 'HP', 'DN', 'OI', 'OE', 'DP', 'BD', 'BW', 'BT', 'BU', 'BV'];

async function candidates(db: Db, companyId: string) {
  return (await sql<{ id: string; doc_no: string; doc_class: string; doc_date: string; locked: boolean }>`
    SELECT h.id, h.doc_no, h.doc_class, h.doc_date::text AS doc_date,
           EXISTS (SELECT 1 FROM gl_period p WHERE p.company_id = h.company_id AND p.deleted_at IS NULL AND p.is_locked AND h.doc_date BETWEEN p.start_date AND p.end_date) AS locked
      FROM doc_header h
     WHERE h.company_id = ${companyId} AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND h.journal_id IS NOT NULL AND NOT h.is_opening
       AND h.doc_class = ANY(${CLASSES}::text[])
       AND EXISTS (SELECT 1 FROM doc_line l WHERE l.header_id = h.id AND l.company_id = h.company_id AND l.deleted_at IS NULL AND (
             (l.department_id IS NOT NULL AND l.department_id IS DISTINCT FROM h.department_id
               AND NOT EXISTS (SELECT 1 FROM gl_journal_line jl WHERE jl.journal_id = h.journal_id AND jl.deleted_at IS NULL AND jl.department_id = l.department_id))
          OR (l.item_id IS NULL AND l.account_id IS NOT NULL AND coalesce(trim(l.description), '') <> ''
               AND NOT EXISTS (SELECT 1 FROM gl_journal_line jl WHERE jl.journal_id = h.journal_id AND jl.deleted_at IS NULL AND jl.description = trim(l.description)))))
     ORDER BY h.doc_date, h.doc_no LIMIT 2000`.execute(db)).rows;
}

/** ยอดรวมทั้งบริษัท (ใบสำคัญปกติทุกใบ) — เทียบก่อน/หลัง */
async function totals(db: Db, companyId: string) {
  const r = (await sql<{ debit: string; credit: string; lines: string }>`SELECT coalesce(sum(l.debit), 0)::text AS debit, coalesce(sum(l.credit), 0)::text AS credit, count(*)::text AS lines
    FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id WHERE j.company_id = ${companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL`.execute(db)).rows[0]!;
  return { debit: d(r.debit).toFixed(2), credit: d(r.credit).toFixed(2) };
}

/** ยอดสุทธิรายบัญชีของการลงใหม่ = ของใบสำคัญปัจจุบัน */
async function sameAmounts(db: Db, companyId: string, headerId: string) {
  const pv = await previewPosting(db, companyId, headerId);
  if (!pv?.lines.length) return false;
  const mine = new Map<string, Decimal>();
  for (const [k, v] of netByAccount(pv.lines)) if (k && !v.toDecimalPlaces(2).isZero()) mine.set(k, v.toDecimalPlaces(2));
  const cur = (await sql<{ acc: string; net: string }>`SELECT l.account_id AS acc, sum(l.debit - l.credit)::text AS net FROM gl_journal_line l JOIN doc_header h ON h.journal_id = l.journal_id
    WHERE h.id = ${headerId} AND h.company_id = ${companyId} AND l.deleted_at IS NULL GROUP BY 1`.execute(db)).rows.filter((x) => !d(x.net).isZero());
  return cur.length === mine.size && cur.every((x) => mine.get(x.acc)?.eq(d(x.net)));
}

export function repostBatchRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/docs/repost-candidates', async (req) => {
    const a = requireCompany(req);
    const all = await candidates(db, a.companyId);
    const rows = all.filter((r) => !r.locked), locked = all.filter((r) => r.locked);   // งวดที่ปิดแล้วลงใหม่ไม่ได้ — แจ้งแยก ไม่ใส่ในรายการที่จะลงใหม่
    return { count: rows.length, rows: rows.slice(0, 500), locked_count: locked.length, locked: locked.slice(0, 100).map((r) => r.doc_no), totals: await totals(db, a.companyId) };
  });

  app.post('/api/v1/docs/repost-batch', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(2000) }), req.body);
    const allowed = new Map((await candidates(db, a.companyId)).filter((r) => !r.locked).map((r) => [r.id, r]));   // เฉพาะเอกสารของบริษัทนี้ที่เข้าเงื่อนไข
    const before = await totals(db, a.companyId);
    const done: string[] = [], skipped: Array<{ doc_no: string; reason: string }> = [];
    for (const id of b.ids) {
      const h = allowed.get(id);
      if (!h) continue;
      try {
        if (!(await sameAmounts(db, a.companyId, id))) { skipped.push({ doc_no: h.doc_no, reason: 'ยอดรายบัญชีของการลงใหม่ไม่เท่าใบสำคัญเดิม (บัญชีที่ตั้งไว้เปลี่ยนไปแล้ว) — ไม่ลงใหม่ ตรวจที่ ลงบัญชีใหม่รายเอกสาร' }); continue; }
        await repostDocument(db, a, id);
        done.push(h.doc_no);
      } catch (e) { skipped.push({ doc_no: h.doc_no, reason: e instanceof Error ? e.message : String(e) }); }
    }
    const after = await totals(db, a.companyId);
    return { reposted: done.length, done, skipped, before, after, same_totals: before.debit === after.debit && before.credit === after.credit };
  });
}
