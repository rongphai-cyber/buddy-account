import { sql } from 'kysely';
import { z } from 'zod';
import { buildPosting, d, formatDocNo, postingBalanced, renderJournalDesc, round2, type PostingLine } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';
import { periodFor } from '../gl/journals.js';
import { recostAfter } from './stockcost.js';
import { numbering } from '../../sync-context.js';
import { loadPostingInput, loadResolver } from '../posting.js';
import { cancelVatEntries, syncVatEntries } from '../vat.js';

type Ctx = { companyId: string; userId: string; branchId?: string | null };

/** สมุดรายวันสำรองตามหมวดเอกสาร เมื่อประเภทเอกสารไม่ได้กำหนดสมุด (เริ่มระบบ 5.1) */
const ROUTE_OF: Record<string, string> = {
  IV: 'CREDIT_SALE', HS: 'CASH_SALE', DR: 'AR_DEBIT_NOTE', CN: 'SALES_RETURN', RE: 'AR_RECEIPT', AI: 'AR_DEPOSIT', OI: 'OTHER_INCOME',
  RR: 'CREDIT_PURCHASE', HP: 'CASH_PURCHASE', CP: 'AP_CREDIT_NOTE', DN: 'PURCHASE_RETURN', PS: 'AP_PAYMENT', AE: 'AP_DEPOSIT', OE: 'OTHER_EXPENSE',
  VR: 'PETTY_CASH_REIMBURSE', OU: 'INTERNAL_ISSUE', JU: 'STOCK_COUNT_ADJ', CA: 'COST_ADJ',
  BD: 'BANK_MOVEMENT', BW: 'BANK_MOVEMENT', BT: 'BANK_MOVEMENT', BU: 'BANK_MOVEMENT', BV: 'BANK_MOVEMENT',
};

/**
 * ออกเลขที่เอกสารถัดไป: ตัวนำหน้า + เลข 7 หลัก (คู่มือบทที่ 9) — ล็อกแถวประเภทเอกสารกันเลขซ้ำเมื่อบันทึกพร้อมกัน
 * ข้ามเลขที่มีเอกสารอยู่แล้ว (เช่น ตั้งเลขถัดไปย้อนหลัง)
 */
export async function issueDocNo(tx: Db, companyId: string, docTypeId: string): Promise<string> {
  // T7.8 ออฟไลน์สาขา: เครื่องสาขาออกเลขจากช่วงที่จอง · สำนักงานใหญ่ใช้เลขเดิมของเอกสารที่ส่งมาจากสาขา
  const special = await numbering.hook?.(tx, companyId, docTypeId);
  if (special) return special;
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

/** ช่องเลขที่เอกสาร (ข้อกำหนดเจ้าของ): ว่าง = ออกเลขอัตโนมัติ · ป้อนเอง = ตัวอักษร/ตัวเลข / - . _ ไม่เกิน 30 ตัว */
/** หมายเหตุรายการ (ข้อกำหนดเจ้าของ 30/10/2569): คีย์ตอนคีย์รายการ หลายบรรทัด + ติ๊กพิมพ์ใต้บรรทัดในเอกสาร — แยกจากหมายเหตุเอกสาร */
export const lineNoteFields = {
  line_note: z.string().trim().max(2000, 'หมายเหตุรายการยาวเกิน 2,000 ตัวอักษร').nullable().optional().transform((v) => v || null),
  line_note_print: z.boolean().default(false),
};
export const noteCols = (l: { line_note?: string | null; line_note_print?: boolean }) => ({ line_note: l.line_note ?? null, line_note_print: !!l.line_note && !!l.line_note_print });
export const docNoInput = z.string().trim().max(30, 'เลขที่เอกสารยาวไม่เกิน 30 ตัวอักษร')
  .regex(/^[A-Za-z0-9ก-๙/._-]*$/, 'เลขที่เอกสารใช้ได้เฉพาะตัวอักษร ตัวเลข และ / - . _ (ไม่มีช่องว่าง)').nullable().optional().transform((v) => v || null);

/** เลขที่เอกสารของเอกสารใหม่: ป้อนเอง (ห้ามซ้ำกับเอกสาร/ใบสำคัญใดในบริษัท) หรือออกเลขถัดไปของประเภทเอกสาร */
export async function docNoFor(tx: Db, companyId: string, docTypeId: string, manual?: string | null): Promise<string> {
  const no = manual?.trim();
  if (!no) return issueDocNo(tx, companyId, docTypeId);
  // ข้อกำหนดเจ้าของ: คีย์เลขเองได้ แต่ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร (เช่น QT…) — ลบตัวนำหน้าออกไม่ได้
  const t = await tx.selectFrom('md_doc_type').select('code').where('id', '=', docTypeId).where('company_id', '=', companyId).executeTakeFirst();
  if (!t) throw notFound('ประเภทเอกสาร');
  if (no.toUpperCase() === t.code.toUpperCase()) return issueDocNo(tx, companyId, docTypeId);
  if (!no.toUpperCase().startsWith(t.code.toUpperCase())) throw badRequest(`เลขที่เอกสารต้องขึ้นต้นด้วย ${t.code} ตามประเภทเอกสาร เช่น ${t.code}${no.replace(/^[A-Za-zก-๙]+/, '') || '0000001'} — หรือเว้นว่างเพื่อใช้เลขอัตโนมัติ`, [{ field: 'doc_no', message: `ต้องขึ้นต้นด้วย ${t.code}` }]);
  const used = await tx.selectFrom('doc_header').select(['doc_no', 'doc_date']).where('company_id', '=', companyId).where('doc_no', '=', no).where('deleted_at', 'is', null).executeTakeFirst()
    ?? await tx.selectFrom('gl_journal').select(['voucher_no as doc_no', 'voucher_date as doc_date']).where('company_id', '=', companyId).where('voucher_no', '=', no).where('deleted_at', 'is', null).executeTakeFirst();
  if (used) throw badRequest(`เลขที่ ${no} มีอยู่แล้ว (ลงวันที่ ${String(used.doc_date).slice(0, 10)}) — เปลี่ยนเลขที่ หรือเว้นว่างเพื่อใช้เลขอัตโนมัติ`, [{ field: 'doc_no', message: 'เลขที่ซ้ำ' }]);
  return no;
}

/** สร้างรายการบัญชีของเอกสาร (ยังไม่บันทึก) — ใช้ทั้งดูตัวอย่างและลงบัญชีจริง */
export async function previewPosting(db: Db, companyId: string, headerId: string) {
  const { H, lines, pays, setts, charges } = await loadPostingInput(db, companyId, [headerId]);
  const h = H[0];
  if (!h) return null;
  const ls = lines.get(h.id) ?? [], ps = pays.get(h.id) ?? [], ss = setts.get(h.id) ?? [], cs = charges.get(h.id) ?? [];
  const r = await loadResolver(db, companyId, {
    customers: [h.customer_id, ...ss.map((s) => s.party_id)].filter((x): x is string => !!x),
    suppliers: [h.supplier_id, ...ss.map((s) => s.party_id)].filter((x): x is string => !!x),
    items: [...ls, ...cs].map((l) => l.item_id).filter((x): x is string => !!x), cheques: ps.map((p) => p.cheque_id).filter((x): x is string => !!x),
  });
  return { header: h, lines: buildPosting(h, ls, ps, ss, r, cs) };
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
    .select(['h.id', 'h.doc_no', 'h.doc_date', 'h.doc_class', 'h.branch_id', 'h.doc_status', 'h.journal_id', 'h.is_opening', 'h.party_name', 'h.remark', 'h.department_id', 't.journal_book_id', 't.journal_desc_template', 't.name_th as type_name', 'h.customer_id', 'h.supplier_id'])
    .where('h.id', '=', headerId).where('h.company_id', '=', ctx.companyId).where('h.deleted_at', 'is', null).executeTakeFirst();
  if (!h) throw notFound('เอกสาร');
  if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
  // ลูกหนี้/เจ้าหนี้ยกมา: ยอดบัญชีอยู่ในยอดยกมาแล้ว ภาษีเกิดก่อนเริ่มใช้ (หรือเกิดตอนชำระถ้าเกณฑ์เงินสด)
  if (h.is_opening) return { journal_id: null };
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
    const h = await tx.selectFrom('doc_header').select(['doc_no', 'doc_status', 'doc_date', 'is_opening']).where('id', '=', headerId).where('company_id', '=', ctx.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (h.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว');
    const paid = await activeSettlement(tx, ctx.companyId, headerId);
    if (paid) throw badRequest(`เอกสาร ${h.doc_no} มีการรับ/จ่ายชำระแล้ว (${paid.doc_no}) — แก้ไขหรือยกเลิกใบเสร็จ/ใบสำคัญจ่าย ${paid.doc_no} ที่ตัดเอกสารนี้ก่อน`);
    // ยอดยกมาลงวันที่ก่อนเริ่มใช้ ไม่ลงบัญชี — ไม่ตรวจงวด (ปีก่อนที่ปิดงวดแล้วก็ยกเลิกได้)
    if (!h.is_opening) await periodFor(tx, ctx.companyId, String(h.doc_date).slice(0, 10));
    else await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    if (before) await before(tx);
    // กฎเหล็ก: เอกสารอื่นที่ยังใช้งานอ้างถึงอยู่ → ยกเลิกไม่ได้ (ตรวจหลังข้อความเฉพาะของแต่ละหน้าจอ)
    const used = await usedBy(tx, ctx.companyId, headerId);
    if (used) throw badRequest(`ยกเลิก ${h.doc_no} ไม่ได้ — มี${used.what} ${used.doc_no} อ้างถึงอยู่ ต้องแก้ไขหรือยกเลิก/ลบ ${used.doc_no} ก่อน`);
    await unpostDocument(tx, ctx, headerId);
    await tx.updateTable('doc_header').set({ doc_status: 'C', cancel_reason: reason.slice(0, 200), updated_by: ctx.userId }).where('id', '=', headerId).execute();
    await cancelVatEntries(tx, ctx.companyId, headerId);
    // ยกเลิกเอกสารที่ตัด/รับสต๊อก → คิดต้นทุนของรายการจ่ายที่ตามมาใหม่
    await recostAfter(tx, ctx, headerId);
    await logActivity(tx, ctx, { module: 'DOC', action: 'CANCEL', docNo: h.doc_no, table: 'doc_header', rowId: headerId, detail: { reason } });
    return { ok: true };
  });
}

/**
 * ลบเอกสาร (ข้อกำหนดเจ้าของ 30/10/2569 ปุ่ม "ลบ"): ต้องยกเลิกก่อน (หน้าจอยกเลิกให้ในขั้นเดียว) แล้วซ่อนจากทุกหน้าจอ/รายงาน
 * และคืนเลขที่ให้ใช้ใหม่ได้ (ดัชนีไม่ซ้ำนับเฉพาะ deleted_at IS NULL) — เก็บประวัติไว้ในบันทึกการทำงาน (ลบไม่ได้) ตามหลักตรวจสอบ
 */
const CHEQUE_IN_SLIP = 'เช็คในใบนำฝาก';
export async function deleteDocument(db: Db, ctx: Ctx, headerId: string, reason: string) {
  return db.transaction().execute(async (tx) => {
    const h = await tx.selectFrom('doc_header').select(['doc_no', 'doc_class', 'doc_status', 'doc_date', 'is_opening', 'net_amount', 'cancel_reason']).where('id', '=', headerId).where('company_id', '=', ctx.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (h.doc_status !== 'C') throw badRequest(`ยกเลิกเอกสาร ${h.doc_no} ก่อนจึงลบได้`);
    if (!h.is_opening) await periodFor(tx, ctx.companyId, String(h.doc_date).slice(0, 10));
    else await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    // เอกสารอื่นที่ยังใช้งานอ้างถึงเอกสารนี้ → ลบไม่ได้ (กฎเดียวกับการยกเลิก)
    const used = await usedBy(tx, ctx.companyId, headerId)
      ?? (await sql<{ doc_no: string }>`SELECT f.cheque_no AS doc_no FROM fin_cheque f WHERE f.deposit_header_id = ${headerId} AND f.deleted_at IS NULL LIMIT 1`.execute(tx)).rows.map((x) => ({ doc_no: x.doc_no, what: CHEQUE_IN_SLIP }))[0];
    if (used) throw badRequest(`ลบ ${h.doc_no} ไม่ได้ — มี${used.what} ${used.doc_no} อ้างถึงอยู่ ต้องแก้ไขหรือยกเลิก/ลบ ${used.doc_no} ก่อน`);
    const gone = { deleted_at: sql`now()` as never, updated_by: ctx.userId };
    const js = (await tx.selectFrom('gl_journal').select('id').where('company_id', '=', ctx.companyId).where('source_header_id', '=', headerId).where('deleted_at', 'is', null).execute()).map((j) => j.id);
    if (js.length) {
      await tx.updateTable('gl_journal_line').set(gone).where('journal_id', 'in', js).where('deleted_at', 'is', null).execute();
      await tx.updateTable('gl_journal').set(gone).where('id', 'in', js).execute();
    }
    for (const t of ['doc_line', 'doc_payment', 'doc_charge', 'doc_note', 'tax_vat_entry', 'tax_wht_entry', 'fin_cheque_event', 'fin_bank_ledger'] as const)
      await tx.updateTable(t).set(gone).where('header_id', '=', headerId).where('deleted_at', 'is', null).execute();
    await tx.updateTable('doc_link').set(gone).where((eb) => eb.or([eb('from_header_id', '=', headerId), eb('to_header_id', '=', headerId)])).where('deleted_at', 'is', null).execute();
    await tx.updateTable('doc_bill_item').set(gone).where((eb) => eb.or([eb('bill_header_id', '=', headerId), eb('invoice_header_id', '=', headerId)])).where('deleted_at', 'is', null).execute();
    await tx.updateTable('doc_settlement').set(gone).where((eb) => eb.or([eb('payment_header_id', '=', headerId), eb('invoice_header_id', '=', headerId)])).where('deleted_at', 'is', null).execute();
    await tx.updateTable('fin_cheque').set(gone).where('company_id', '=', ctx.companyId).where('source_header_id', '=', headerId).where('deleted_at', 'is', null).execute();
    await tx.updateTable('doc_header').set(gone).where('id', '=', headerId).execute();
    await logActivity(tx, ctx, { module: 'DOC', action: 'DELETE', docNo: h.doc_no, table: 'doc_header', rowId: headerId,
      detail: { reason, doc_class: h.doc_class, doc_date: String(h.doc_date).slice(0, 10), net_amount: h.net_amount, cancel_reason: h.cancel_reason, journals: js } });
    return { ok: true, doc_no: h.doc_no };
  });
}

/**
 * กฎเหล็กการยกเลิก/ลบ (ข้อกำหนดเจ้าของ 30/10/2569): เอกสารที่เอกสารอื่น (ที่ยังใช้งาน) อ้างถึงอยู่ ยกเลิกหรือลบไม่ได้
 * ต้องแก้/ยกเลิก/ลบเอกสารที่อ้างถึงก่อน — คืนเอกสารแรกที่อ้างถึง หรือ null
 * ตรวจ: มัดจำ/แปลงใบเสนอราคา/เบิกชดเชย (doc_link) · บิลที่อ้างใบสั่ง · ใบวางบิล · รับ/จ่ายชำระ · ใบลด/เพิ่มหนี้ที่อ้างใบกำกับ · ขายทรัพย์สิน
 */
export async function usedBy(tx: Db, companyId: string, headerId: string): Promise<{ doc_no: string; what: string } | null> {
  const r = (await sql<{ doc_no: string; what: string }>`
    SELECT o.doc_no, CASE l.link_type WHEN 'DEPOSIT' THEN 'บิลที่หักมัดจำ' WHEN 'CONVERT' THEN 'ใบสั่งขายที่แปลงจากใบนี้' WHEN 'REIMBURSE' THEN 'ใบเบิกชดเชย' ELSE 'เอกสาร' END AS what
      FROM doc_link l JOIN doc_header o ON o.id = l.to_header_id
     WHERE l.from_header_id = ${headerId} AND l.deleted_at IS NULL AND o.doc_status <> 'C' AND o.deleted_at IS NULL
    UNION ALL SELECT t.doc_no, 'บิลที่อ้างใบสั่งนี้' FROM doc_line x JOIN doc_line s ON s.id = x.source_line_id JOIN doc_header t ON t.id = x.header_id
     WHERE s.header_id = ${headerId} AND x.header_id <> ${headerId} AND x.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL
    UNION ALL SELECT b.doc_no, 'ใบวางบิล' FROM doc_bill_item i JOIN doc_header b ON b.id = i.bill_header_id
     WHERE i.invoice_header_id = ${headerId} AND i.deleted_at IS NULL AND b.doc_status <> 'C' AND b.deleted_at IS NULL
    UNION ALL SELECT coalesce(p.doc_no, j.voucher_no), 'การรับ/จ่ายชำระ' FROM doc_settlement s LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
     WHERE s.invoice_header_id = ${headerId} AND s.deleted_at IS NULL AND coalesce(p.doc_status, j.doc_status) <> 'C' AND p.deleted_at IS NULL AND j.deleted_at IS NULL
    UNION ALL SELECT r.doc_no, 'ใบลด/เพิ่มหนี้ที่อ้างใบกำกับนี้' FROM doc_header h JOIN doc_header r ON r.company_id = h.company_id AND r.ref_no = h.doc_no
       AND ((h.doc_class IN ('IV', 'HS') AND r.doc_class IN ('CN', 'DR') AND r.customer_id = h.customer_id) OR (h.doc_class IN ('RR', 'HP') AND r.doc_class IN ('DN', 'CP') AND r.supplier_id = h.supplier_id))
     WHERE h.id = ${headerId} AND r.id <> h.id AND r.doc_status <> 'C' AND r.deleted_at IS NULL
    UNION ALL SELECT a.code, 'ทะเบียนทรัพย์สินที่ขายด้วยเอกสารนี้' FROM fa_asset a WHERE a.company_id = ${companyId} AND a.sold_header_id = ${headerId} AND a.deleted_at IS NULL
    LIMIT 1`.execute(tx)).rows[0];
  return r ?? null;
}
