import { sql } from 'kysely';
import { buildPosting, d, formatDocNo, postingBalanced, renderJournalDesc, round2, type PostingLine } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { periodFor } from '../gl/journals.js';
import { loadPostingInput, loadResolver } from '../posting.js';
import { cancelVatEntries, syncVatEntries } from '../vat.js';

type Ctx = { companyId: string; userId: string; branchId?: string | null };

/** สมุดรายวันสำรองตามหมวดเอกสาร เมื่อประเภทเอกสารไม่ได้กำหนดสมุด (เริ่มระบบ 5.1) */
const ROUTE_OF: Record<string, string> = {
  IV: 'CREDIT_SALE', HS: 'CASH_SALE', DR: 'AR_DEBIT_NOTE', CN: 'SALES_RETURN', RE: 'AR_RECEIPT', AI: 'AR_DEPOSIT', OI: 'OTHER_INCOME',
  RR: 'CREDIT_PURCHASE', HP: 'CASH_PURCHASE', CP: 'AP_CREDIT_NOTE', DN: 'PURCHASE_RETURN', PS: 'AP_PAYMENT', AE: 'AP_DEPOSIT', OE: 'OTHER_EXPENSE',
  VR: 'PETTY_CASH_REIMBURSE',
};

/**
 * ออกเลขที่เอกสารถัดไป: ตัวนำหน้า + เลข 7 หลัก (คู่มือบทที่ 9) — ล็อกแถวประเภทเอกสารกันเลขซ้ำเมื่อบันทึกพร้อมกัน
 * ข้ามเลขที่มีเอกสารอยู่แล้ว (เช่น ตั้งเลขถัดไปย้อนหลัง)
 */
export async function issueDocNo(tx: Db, companyId: string, docTypeId: string): Promise<string> {
  const t = (await sql<{ code: string; next_no: string }>`SELECT code, next_no FROM md_doc_type WHERE id = ${docTypeId} AND company_id = ${companyId} AND deleted_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
  if (!t) throw notFound('ประเภทเอกสาร');
  let n = Number(t.next_no);
  for (let i = 0; i < 1000; i++, n++) {
    const no = formatDocNo(t.code, n);
    const used = await tx.selectFrom('doc_header').select('id').where('company_id', '=', companyId).where('doc_no', '=', no).where('deleted_at', 'is', null).executeTakeFirst();
    if (!used) {
      await tx.updateTable('md_doc_type').set({ next_no: n + 1 }).where('id', '=', docTypeId).execute();
      return no;
    }
  }
  throw badRequest(`ออกเลขที่เอกสาร ${t.code} ไม่ได้ — ตรวจเลขที่ถัดไปที่ เริ่มระบบ › เลขที่เอกสาร`);
}

/** สร้างรายการบัญชีของเอกสาร (ยังไม่บันทึก) — ใช้ทั้งดูตัวอย่างและลงบัญชีจริง */
export async function previewPosting(db: Db, companyId: string, headerId: string) {
  const { H, lines, pays, setts } = await loadPostingInput(db, companyId, [headerId]);
  const h = H[0];
  if (!h) return null;
  const ls = lines.get(h.id) ?? [], ps = pays.get(h.id) ?? [], ss = setts.get(h.id) ?? [];
  const r = await loadResolver(db, companyId, {
    customers: [h.customer_id, ...ss.map((s) => s.party_id)].filter((x): x is string => !!x),
    suppliers: [h.supplier_id, ...ss.map((s) => s.party_id)].filter((x): x is string => !!x),
    items: ls.map((l) => l.item_id).filter((x): x is string => !!x), cheques: ps.map((p) => p.cheque_id).filter((x): x is string => !!x),
  });
  return { header: h, lines: buildPosting(h, ls, ps, ss, r) };
}

/** รวมบรรทัดบัญชีเดียวกันบทบาทเดียวกัน (Express ลงยอดรวมต่อบัญชี) */
function mergeLines(lines: PostingLine[]) {
  const m = new Map<string, PostingLine>();
  for (const l of lines) {
    const k = `${l.account_id}|${l.role}|${l.debit.gt(0) ? 'D' : 'C'}`;
    const cur = m.get(k);
    if (cur) { cur.debit = cur.debit.plus(l.debit); cur.credit = cur.credit.plus(l.credit); } else m.set(k, { ...l });
  }
  return [...m.values()].filter((l) => !l.debit.isZero() || !l.credit.isZero());
}

/**
 * ลงบัญชีเอกสาร: บันทึก = ลงบัญชีทันทีในทรานแซกชันเดียวกับเอกสาร (กติกาข้อ 6)
 * ใบสำคัญ: เลขที่ = เลขที่เอกสาร · สมุดรายวันจากประเภทเอกสาร (หรือเส้นทางตามรายการ) · คำอธิบายจากแม่แบบของประเภทเอกสาร
 * ไม่เชื่อมต่อระบบบัญชี (gen.link_gl = false) → ไม่ลง และไม่ลงย้อนหลังเมื่อเปิดภายหลัง (คู่มือหน้า 156)
 */
export async function postDocument(tx: Db, ctx: Ctx, headerId: string, existingJournalId?: string | null): Promise<{ journal_id: string | null }> {
  const h = await tx.selectFrom('doc_header as h').innerJoin('md_doc_type as t', 't.id', 'h.doc_type_id')
    .select(['h.id', 'h.doc_no', 'h.doc_date', 'h.doc_class', 'h.branch_id', 'h.doc_status', 'h.journal_id', 'h.party_name', 'h.remark', 'h.department_id', 't.journal_book_id', 't.journal_desc_template', 't.name_th as type_name', 'h.customer_id', 'h.supplier_id'])
    .where('h.id', '=', headerId).where('h.company_id', '=', ctx.companyId).where('h.deleted_at', 'is', null).executeTakeFirst();
  if (!h) throw notFound('เอกสาร');
  if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
  // แฟ้มภาษีซื้อ/ขาย (บทที่ 16) เกิดพร้อมเอกสารเสมอ แม้ไม่เชื่อมต่อระบบบัญชี
  await syncVatEntries(tx, ctx, headerId);
  if ((await companySettings(tx, ctx.companyId))['gen.link_gl'] === false) return { journal_id: null };
  const pv = await previewPosting(tx, ctx.companyId, headerId);
  if (!pv || !pv.lines.length) return { journal_id: null };   // หมวดที่ไม่ลงบัญชี (ใบเสนอราคา ใบสั่งขาย ฯลฯ)
  if (!postingBalanced(pv.lines)) throw badRequest(`ลงบัญชีเอกสาร ${h.doc_no} ไม่ได้: รายการ Dr/Cr ไม่ดุล — ตรวจยอดเงินในเอกสาร`);
  if (pv.lines.some((l) => !l.account_id)) throw badRequest('ลงบัญชีไม่ได้: ไม่พบเลขที่บัญชีและยังไม่ได้กำหนดบัญชีพัก — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี › บัญชีเพื่อลงรายวัน');
  const p = await periodFor(tx, ctx.companyId, String(h.doc_date).slice(0, 10));
  let book = h.journal_book_id;
  if (!book) {
    const route = ROUTE_OF[h.doc_class];
    book = route ? (await tx.selectFrom('gl_journal_route').select('journal_book_id').where('company_id', '=', ctx.companyId).where('txn_kind', '=', route).where('deleted_at', 'is', null).executeTakeFirst())?.journal_book_id ?? null : null;
    book ??= (await tx.selectFrom('gl_journal_book').select('id').where('company_id', '=', ctx.companyId).where('code', '=', '00').where('deleted_at', 'is', null).executeTakeFirst())?.id ?? null;
  }
  if (!book) throw badRequest('ไม่พบสมุดรายวันสำหรับลงบัญชี — กำหนดที่ เริ่มระบบ › เลขที่เอกสาร');
  const party = h.customer_id
    ? await tx.selectFrom('md_customer').select(['title', 'name']).where('id', '=', h.customer_id).executeTakeFirst()
    : h.supplier_id ? await tx.selectFrom('md_supplier').select(['title', 'name']).where('id', '=', h.supplier_id).executeTakeFirst() : undefined;
  const desc = renderJournalDesc(h.journal_desc_template, { party: { title: party?.title, name: party?.name ?? h.party_name }, doc: { remark: h.remark, no: h.doc_no } })
    || [h.type_name, party?.name ?? h.party_name].filter(Boolean).join(' ');
  const lines = mergeLines(pv.lines);
  const total = round2(lines.reduce((s, l) => s.plus(l.debit), d(0)));
  const head = { branch_id: h.branch_id, journal_book_id: book, voucher_date: h.doc_date, period_id: p.id, description: desc.slice(0, 200) || null, reference: h.doc_no,
    doc_status: 'N', posted_by: ctx.userId, posted_at: sql`now()` as never, total_debit: total.toFixed(2), total_credit: total.toFixed(2), updated_by: ctx.userId };
  let j: { id: string };
  if (existingJournalId) {
    // ลงบัญชีใหม่: ใบสำคัญเดิม เลขที่เดิม — บรรทัดเก่าเก็บไว้ (deleted_at) เป็นประวัติ
    await tx.updateTable('gl_journal_line').set({ deleted_at: sql`now()` as never, updated_by: ctx.userId }).where('journal_id', '=', existingJournalId).where('deleted_at', 'is', null).execute();
    await tx.updateTable('gl_journal').set(head).where('id', '=', existingJournalId).execute();
    j = { id: existingJournalId };
  } else {
    j = await tx.insertInto('gl_journal').values({ ...head, company_id: ctx.companyId, voucher_no: h.doc_no, source_module: pv.header.doc_class, source_header_id: h.id, status: 'P', created_by: ctx.userId })
      .returning('id').executeTakeFirstOrThrow();
  }
  let n = 0;
  for (const l of lines) {
    await tx.insertInto('gl_journal_line').values({
      company_id: ctx.companyId, journal_id: j.id, line_no: ++n, account_id: l.account_id!, department_id: h.department_id, description: null,
      debit: round2(l.debit).toFixed(2), credit: round2(l.credit).toFixed(2), posting_role: l.role, resolved_from: l.layer, created_by: ctx.userId,
    }).execute();
  }
  await tx.updateTable('doc_header').set({ gl_posted: 'Y', journal_id: j.id }).where('id', '=', h.id).execute();
  return { journal_id: j.id };
}

/** ยกเลิกการลงบัญชีของเอกสาร (ใบสำคัญเป็นสถานะ C — ไม่ลบ) */
export async function unpostDocument(tx: Db, ctx: Ctx, headerId: string) {
  const js = await tx.selectFrom('gl_journal').select(['id', 'voucher_date']).where('company_id', '=', ctx.companyId).where('source_header_id', '=', headerId).where('doc_status', '<>', 'C').where('deleted_at', 'is', null).execute();
  for (const j of js) {
    await periodFor(tx, ctx.companyId, String(j.voucher_date).slice(0, 10));   // งวดที่ปิดแล้วแก้ไม่ได้
    await tx.updateTable('gl_journal').set({ doc_status: 'C', updated_by: ctx.userId }).where('id', '=', j.id).execute();
  }
  await tx.updateTable('doc_header').set({ gl_posted: 'N', journal_id: null }).where('id', '=', headerId).execute();
  return js.length;
}

/** ลงบัญชีใหม่ (เริ่มระบบ 5.4 รายเอกสาร): ยกเลิกใบสำคัญเดิมแล้วลงใหม่ตามบัญชีปัจจุบัน */
export async function repostDocument(db: Db, ctx: Ctx, headerId: string) {
  return db.transaction().execute(async (tx) => {
    const h = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status']).where('id', '=', headerId).where('company_id', '=', ctx.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
    const cur = await tx.selectFrom('gl_journal').select(['id', 'voucher_date']).where('company_id', '=', ctx.companyId).where('source_header_id', '=', headerId).where('deleted_at', 'is', null).orderBy('created_at', 'desc').executeTakeFirst();
    if (cur) await periodFor(tx, ctx.companyId, String(cur.voucher_date).slice(0, 10));   // งวดที่ปิดแล้วลงใหม่ไม่ได้
    const r = await postDocument(tx, ctx, headerId, cur?.id);
    if (!r.journal_id && cur) await unpostDocument(tx, ctx, headerId);   // ปิดการเชื่อมต่อบัญชี/ไม่มีรายการ → ยกเลิกใบเดิม
    await logActivity(tx, ctx, { module: 'GL', action: 'REPOST', docNo: h.doc_no, table: 'doc_header', rowId: headerId, detail: { journal_id: r.journal_id, previous: cur?.id ?? null } });
    return r;
  });
}

/** ยกเลิกเอกสาร: สถานะ C (ไม่ลบ) + ยกเลิกใบสำคัญที่เกิดจากเอกสาร (กติกาข้อ 6) */
/** ใบเสร็จ/ใบสำคัญจ่ายที่ยังไม่ยกเลิกซึ่งตัดเอกสารนี้ (ใบแรก) — ใช้กันแก้/ยกเลิกบิลที่รับ/จ่ายชำระแล้ว */
export async function activeSettlement(db: Db, companyId: string, invoiceId: string) {
  return (await sql<{ doc_no: string }>`SELECT coalesce(p.doc_no, j.voucher_no) AS doc_no FROM doc_settlement s
      LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
     WHERE s.company_id = ${companyId} AND s.invoice_header_id = ${invoiceId} AND s.deleted_at IS NULL
       AND coalesce(p.doc_status, 'N') <> 'C' AND coalesce(j.doc_status, 'N') <> 'C' LIMIT 1`.execute(db)).rows[0];
}

/** before: งานเพิ่มเติมของเอกสารแต่ละชนิดในทรานแซกชันเดียวกัน (เช่น ใบเสร็จ: ยกเลิกเช็ค/ภาษีหัก ณ ที่จ่าย) */
export async function cancelDocument(db: Db, ctx: Ctx, headerId: string, reason: string, before?: (tx: Db) => Promise<void>) {
  return db.transaction().execute(async (tx) => {
    const h = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_date']).where('id', '=', headerId).where('company_id', '=', ctx.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
    const paid = await activeSettlement(tx, ctx.companyId, headerId);
    if (paid) throw badRequest(`เอกสาร ${h.doc_no} มีการรับ/จ่ายชำระแล้ว — ยกเลิกใบเสร็จ/ใบสำคัญจ่ายที่ตัดเอกสารนี้ก่อน`);
    await periodFor(tx, ctx.companyId, String(h.doc_date).slice(0, 10));
    if (before) await before(tx);
    await unpostDocument(tx, ctx, headerId);
    await tx.updateTable('doc_header').set({ doc_status: 'C', cancel_reason: reason.slice(0, 200), updated_by: ctx.userId }).where('id', '=', headerId).execute();
    await cancelVatEntries(tx, ctx.companyId, headerId);
    await logActivity(tx, ctx, { module: 'DOC', action: 'CANCEL', docNo: h.doc_no, table: 'doc_header', rowId: headerId, detail: { reason } });
    return { ok: true };
  });
}
