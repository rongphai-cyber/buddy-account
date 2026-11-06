import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { computeDoc, d, dueDate } from '@buddy/core';
import type { Db } from '../../db.js';
import { AppError, badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { checkOwned } from '../../owned.js';
import { cancelDocument, postDocument, unpostDocument, usedBy } from './engine.js';
import { saveBranch } from './payments.js';
import { previewQuery, previewSave } from './preview.js';

/**
 * ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04): บิลค้าง ณ วันเริ่มใช้ — เลขที่ป้อนเอง ลงวันที่ก่อนเริ่มใช้
 * เป็นเอกสาร IV/RR ที่ is_opening = true: ไม่ลงบัญชี (ยอดบัญชีป้อนที่ บันทึกยอดยกมา) ไม่ตัดสต๊อก ไม่เข้าแฟ้มภาษี
 * ภาษีเกณฑ์เงินสด (ไม่ระบุวันที่ภาษีเกิด) เกิดเมื่อรับ/จ่ายชำระในระบบ
 *
 * ยอดยกมาที่ลงบัญชี (HANDOFF ข้อ 86 · ระบบอื่นเช่น WTS-Living ส่งยอดค้าง/เงินประกันที่นำเข้ามา): `post_gl: true` + บัญชีคู่
 *  (`offset_account_id` — ว่าง = บัญชีพักยอดยกมา บทบาท OPENING_BALANCE) → ลงบัญชีในทรานแซกชันเดียวกัน (openingPosting ใน packages/core)
 *  ลูกหนี้ยกมา Dr ลูกหนี้ / Cr บัญชีคู่ ยอดค้างรวม VAT (ภาษีขายรอเรียกเก็บอยู่ในยอดยกมาเดิม — ไม่ลงซ้ำ) · มัดจำรับยกมา (ar-deposit-opening, AI) Dr บัญชีคู่ / Cr เงินมัดจำรับ
 *  บัญชีคู่ต้องเป็นบัญชีงบดุล (หมวด 1–3) ไม่ใช่รายได้ปีนี้ · ไม่เข้าแฟ้มภาษี (VAT ถึงกำหนดตอนรับชำระ) · ลงวันที่ก่อนเริ่มใช้ = ยอดยกมาของงบทดลอง
 *  ลงวันที่ตั้งแต่วันเริ่มใช้ได้ (เริ่มใช้ระบบอื่นทีหลัง Buddy) — ต้องอยู่ในงวดที่ยังไม่ปิด
 */
type Ctx = AuthContext & { companyId: string };
export const OPENING_KINDS = [
  { path: 'ar-opening', cls: 'IV', module: 'AR', menu: 'FI.AR.OB', party: 'customer', label: 'ลูกหนี้คงค้าง-ยกมา' },
  { path: 'ap-opening', cls: 'RR', module: 'AP', menu: 'FI.AP.OB', party: 'supplier', label: 'เจ้าหนี้คงค้าง-ยกมา' },
  // มัดจำรับ/เงินประกันยกมา (HANDOFF ข้อ 86): ใบมัดจำรับ AI ที่ is_opening — หัก (RE) / คืน (RD) ได้เหมือนใบมัดจำปกติ · ไม่มี VAT
  // หน้าจอ/สิทธิ์ของตัวเอง FI.AR.DOB (HANDOFF ข้อ 91)
  { path: 'ar-deposit-opening', cls: 'AI', module: 'AR', menu: 'FI.AR.DOB', party: 'customer', label: 'เงินมัดจำรับ-ยกมา' },
] as const;
type Kind = (typeof OPENING_KINDS)[number];
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const body = z.object({
  branch_id: z.string().uuid().nullable().optional(), party_id: z.string({ required_error: 'เลือกลูกค้า/ผู้จำหน่าย', invalid_type_error: 'เลือกลูกค้า/ผู้จำหน่าย' }).uuid('เลือกลูกค้า/ผู้จำหน่าย'),
  doc_no: z.string().trim().min(1, 'ป้อนเลขที่เอกสาร (แนะนำใส่ปีนำหน้า เช่น IV67/0001)').max(30), doc_date: isoDate, ref_no: str(30),
  department_id: optId, salesperson_id: optId, credit_days: z.coerce.number().int().min(0).max(999).nullable().optional(), due_date: isoDate.nullable().optional(),
  price_type: z.enum(['0', '1', '2']), amount: num, discount_text: str(20), vat_rate: num,
  /** ปัดเศษไม่ตรงบิล: อัตรา 0% แล้วป้อนจำนวนภาษีเอง (คู่มือหน้า 143) */
  vat_amount: num.nullable().optional(),
  /** วันที่ภาษีเกิดขึ้นแล้ว — ว่าง = เกณฑ์เงินสด (ภาษีเกิดเมื่อชำระ) */
  vat_date: isoDate.nullable().optional(), remark: str(2000),
  /** ประเภทเอกสาร (ว่าง = ประเภทแรกของหมวด) — ลูกหนี้ยกมาใช้บัญชีลูกหนี้ของประเภทนี้ · มัดจำยกมาใช้บัญชีเงินมัดจำรับของประเภทนี้ */
  doc_type_id: z.string().uuid('เลือกประเภทเอกสาร').nullable().optional().transform((v) => v ?? null),
  /** ลงบัญชียอดยกมา (ระบบอื่นที่นำเข้ายอดค้างเอง) — false = แบบเดิม: ไม่ลงบัญชี ยอดบัญชีป้อนที่บันทึกยอดยกมา */
  post_gl: z.boolean().default(false),
  offset_account_id: z.string().uuid('เลือกบัญชีคู่ของยอดยกมา').nullable().optional().transform((v) => v ?? null),
});

/** บัญชีคู่ของยอดยกมาที่ลงบัญชี: ที่ส่งมา หรือบัญชีพักยอดยกมา (OPENING_BALANCE) · ต้องเป็นบัญชีย่อยในหมวดงบดุล */
async function offsetAccount(db: Db, companyId: string, requested: string | null) {
  const id = requested ?? (await db.selectFrom('gl_default_account').select('account_id').where('company_id', '=', companyId).where('role', '=', 'OPENING_BALANCE').where('deleted_at', 'is', null).executeTakeFirst())?.account_id ?? null;
  if (!id) throw badRequest('ยังไม่ได้กำหนดบัญชีพักยอดยกมา — กด "ตั้งค่าสำหรับ WTS-Living" ที่ รายละเอียดกิจการ หรือกำหนดบทบาท "บัญชีพักยอดยกมา" ที่ เริ่มระบบ › การเชื่อมต่อบัญชี', [{ field: 'offset_account_id', message: 'เลือกบัญชีคู่' }]);
  const acc = await db.selectFrom('gl_account').select(['account_no', 'account_group', 'is_control', 'status']).where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!acc) throw badRequest('ไม่พบบัญชีคู่ของยอดยกมาในผังบัญชีของบริษัทนี้ — เลือกบัญชีใหม่', [{ field: 'offset_account_id', message: 'เลือกบัญชีใหม่' }]);
  if (acc.is_control) throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีคุม ลงรายการไม่ได้ — เลือกบัญชีย่อย`, [{ field: 'offset_account_id', message: 'เลือกบัญชีย่อย' }]);
  if (acc.account_group >= '4') throw badRequest(`บัญชี ${acc.account_no} เป็นบัญชีรายได้/ค่าใช้จ่าย — ยอดยกมาไม่ใช่รายได้ปีนี้ เลือกบัญชีงบดุล (หมวด 1–3) เช่น บัญชีพักยอดยกมา`, [{ field: 'offset_account_id', message: 'เลือกบัญชีงบดุล' }]);
  return id;
}

/**
 * กันลูกหนี้ยกมาลงบัญชีซ้ำ (HANDOFF ข้อ 86 "ยังเหลือ" → ข้อ 91): บริษัทที่คีย์ยอดยกมาของบัญชีลูกหนี้ไว้แล้วที่ บันทึกยอดยกมา (gl_balance.opening)
 * ถ้ารับลูกหนี้ยกมาแบบลงบัญชี (post_gl) อีก ยอดลูกหนี้จะนับสองครั้ง → ปฏิเสธ 409 OPENING_ALREADY_KEYED (ถอยกลับทั้งทรานแซกชัน)
 * ปีบัญชีที่ตรวจ = ปีที่ใบสำคัญยอดยกมาตกอยู่: วันที่ก่อนวันเริ่มใช้ = ปีบัญชีแรกหลังวันที่นั้น · ตั้งแต่วันเริ่มใช้ = ปีบัญชีของวันที่นั้น
 * บัญชีที่ตรวจ = บัญชีที่ใบสำคัญนี้ลง Dr (บัญชีลูกหนี้) ยกเว้นบัญชีคู่
 */
async function guardKeyedOpening(tx: Db, companyId: string, journalId: string, offset: string, docDate: string) {
  const rows = (await sql<{ account_no: string; name_th: string; opening: string }>`
    SELECT g.account_no, g.name_th, sum(b.opening)::text AS opening
      FROM gl_balance b JOIN gl_period p ON p.id = b.period_id JOIN gl_account g ON g.id = b.account_id
     WHERE b.company_id = ${companyId} AND b.deleted_at IS NULL AND b.opening <> 0
       AND b.account_id IN (SELECT l.account_id FROM gl_journal_line l WHERE l.journal_id = ${journalId} AND l.deleted_at IS NULL AND l.debit > 0 AND l.account_id <> ${offset})
       AND p.fiscal_year_id = coalesce(
         (SELECT x.fiscal_year_id FROM gl_period x WHERE x.company_id = ${companyId} AND x.deleted_at IS NULL AND ${docDate}::date BETWEEN x.start_date AND x.end_date ORDER BY x.start_date LIMIT 1),
         (SELECT y.id FROM gl_fiscal_year y WHERE y.company_id = ${companyId} AND y.deleted_at IS NULL AND y.start_date > ${docDate}::date ORDER BY y.start_date LIMIT 1))
     GROUP BY g.account_no, g.name_th ORDER BY g.account_no`.execute(tx)).rows;
  if (!rows.length) return;
  const list = rows.map((r) => `${r.account_no} ${r.name_th} ${d(r.opening).abs().toFixed(2)} (${d(r.opening).gte(0) ? 'เดบิต' : 'เครดิต'})`).join(' · ');
  const nos = rows.map((r) => r.account_no).join(' ');
  throw new AppError(409, 'OPENING_ALREADY_KEYED',
    `ลูกหนี้ยกมานี้ลงบัญชีไม่ได้ — บันทึกยอดยกมามียอดของบัญชีลูกหนี้ ${list} อยู่แล้ว ถ้าลงบัญชีอีกยอดลูกหนี้จะซ้ำ · วิธีแก้ (เลือกอย่างใดอย่างหนึ่ง): (1) ที่ Buddy เมนู บัญชี › บันทึกยอดยกมา ลบยอดของบัญชี ${nos} (ย้ายยอดนั้นไปบัญชีพักยอดยกมา) แล้วส่งลูกหนี้ยกมาใหม่ หรือ (2) ส่งลูกหนี้ยกมาแบบไม่ลงบัญชี (post_gl: false — เข้าทะเบียนลูกหนี้อย่างเดียว ยอดบัญชีใช้ยอดที่คีย์ไว้)`,
    rows.map((r) => ({ field: 'post_gl', message: `บัญชี ${r.account_no} มียอดยกมา ${d(r.opening).toFixed(2)}` })));
}

/** วันเริ่มใช้โปรแกรม = วันเริ่มปีบัญชีแรกที่ยังไม่ปิด */
async function startDate(db: Db, companyId: string) {
  const y = await db.selectFrom('gl_fiscal_year').select('start_date').where('company_id', '=', companyId).where('deleted_at', 'is', null).where('status', '<>', 'C').orderBy('start_date').executeTakeFirst();
  return y ? String(y.start_date).slice(0, 10) : null;
}

async function save(db: Db, a: Ctx, K: Kind, id: string | null, b: z.infer<typeof body>) {
  const start = await startDate(db, a.companyId);
  // ยอดยกมาที่ลงบัญชีลงวันที่ตั้งแต่วันเริ่มใช้ได้ (ระบบอื่นเริ่มใช้ทีหลัง) — แบบเดิมต้องก่อนวันเริ่มใช้
  if (start && b.doc_date >= start && !b.post_gl) throw badRequest(`วันที่ต้องก่อนวันเริ่มใช้โปรแกรม (${start}) — ยอดยกมาคือบิลที่ค้าง ณ วันเริ่มใช้`);
  if (b.post_gl && K.party !== 'customer') throw badRequest('ลงบัญชียอดยกมาได้เฉพาะลูกหนี้/มัดจำรับยกมา — เจ้าหนี้ยกมาบันทึกยอดบัญชีที่ บันทึกยอดยกมา');
  const offset = b.post_gl ? await offsetAccount(db, a.companyId, b.offset_account_id) : null;
  const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
  const party = await db.selectFrom(partyTbl).select(['id', 'code', 'title', 'name', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no', 'credit_days']).where('id', '=', b.party_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!party) throw badRequest(`ไม่พบ${K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้`);
  // พนักงานขาย (ลูกหนี้ยกมา — ว่าง = ตามรายละเอียดลูกค้า) / แผนก ต้องเป็นของบริษัทนี้
  const slm = K.party === 'customer' ? b.salesperson_id ?? (await db.selectFrom('md_customer').select('salesperson_id').where('id', '=', party.id).executeTakeFirst())?.salesperson_id ?? null : null;
  await checkOwned(db, a.companyId, [{ table: 'md_salesperson', id: slm, field: 'salesperson_id' }, { table: 'md_department', id: b.department_id, field: 'department_id' }]);
  const what = K.cls === 'IV' ? 'ขายเงินเชื่อ' : K.cls === 'AI' ? 'รับเงินมัดจำ' : 'ซื้อเงินเชื่อ';
  const dt = await db.selectFrom('md_doc_type').select(['id']).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('deleted_at', 'is', null)
    .$if(!!b.doc_type_id, (q) => q.where('id', '=', b.doc_type_id!)).orderBy('code').executeTakeFirst();
  if (!dt && b.doc_type_id) throw badRequest(`ไม่พบประเภทเอกสาร${what}นี้ในบริษัทนี้ — เลือกประเภทเอกสารใหม่`, [{ field: 'doc_type_id', message: 'เลือกใหม่' }]);
  if (!dt) throw badRequest(`ยังไม่มีประเภทเอกสาร${what} — เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร`);
  const manualVat = b.vat_amount != null && d(b.vat_rate).isZero();
  const calc = computeDoc({ price_type: b.price_type, vat_rate: b.vat_rate, discount_text: b.discount_text, lines: [{ qty: 1, unit_price: b.amount }] });
  if (calc.errors.length) throw badRequest(calc.errors[0]!);
  const vat = manualVat ? d(b.vat_amount!) : d(calc.vat_amount);
  const net = manualVat ? d(calc.amount_after_discount).plus(b.price_type === '1' ? 0 : vat) : d(calc.net_amount);
  if (net.lte(0)) throw badRequest('จำนวนเงินรวมทั้งสิ้นต้องมากกว่า 0');
  if (K.cls === 'AI' && !vat.isZero()) throw badRequest('เงินมัดจำยกมาที่มี VAT ยังรับไม่ได้ — ภาษีของมัดจำยื่นไปแล้วในระบบเดิม ใส่ยอดมัดจำไม่รวมการคิดภาษีใหม่ (อัตรา 0)');
  const credit = b.credit_days ?? party.credit_days ?? 0;
  const branchId = await saveBranch(db, a, id, b.branch_id);
  const header = {
    ...(branchId ? { branch_id: branchId } : {}), 
    doc_class: K.cls, module: K.module, doc_no: b.doc_no, doc_date: b.doc_date, is_opening: true, customer_id: K.party === 'customer' ? party.id : null, supplier_id: K.party === 'supplier' ? party.id : null,
    party_name: [party.title, party.name].filter(Boolean).join(' ').slice(0, 200), party_address: [party.address_1, party.address_2, party.address_3, party.zip_code].filter(Boolean).join(' ').slice(0, 500) || null,
    party_tax_id: party.tax_id, party_tax_branch_no: party.tax_branch_no, ref_no: b.ref_no, department_id: b.department_id, salesperson_id: slm,
    credit_days: credit, due_date: b.due_date ?? dueDate(b.doc_date, credit), price_type: b.price_type, vat_rate: b.vat_rate, discount_text: b.discount_text,
    amount: calc.amount, discount_amount: calc.discount_amount, amount_after_discount: calc.amount_after_discount, taxable_amount: manualVat ? net.minus(vat).toFixed(2) : calc.taxable_amount,
    vat_amount: vat.toFixed(2), net_amount: net.toFixed(2), vat_basis: b.vat_date ? '1' : '2', vat_date: b.vat_date ?? null, remark: b.remark, gl_posted: 'N', updated_by: a.userId,
    doc_type_id: dt.id, opening_offset_account_id: offset,
  };
  return db.transaction().execute(async (tx) => {
    // ยอดยกมาไม่ลงบัญชี — ลงวันที่ในปีก่อนที่ปิดงวดแล้วได้ (วันที่ต้องก่อนวันเริ่มใช้โปรแกรม ตรวจแล้วข้างบน)
    await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
    const dup = await tx.selectFrom('doc_header').select('id').where('company_id', '=', a.companyId).where('doc_type_id', '=', dt.id).where('doc_no', '=', b.doc_no).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw badRequest(`เลขที่ ${b.doc_no} มีอยู่แล้ว — แนะนำใส่ปีนำหน้าเพื่อไม่ให้ซ้ำกับเลขปีปัจจุบัน`);
    let hid = id;
    if (id) {
      const cur = await tx.selectFrom('doc_header').select(['doc_status', 'is_opening', 'doc_class']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur || !cur.is_opening || cur.doc_class !== K.cls) throw notFound(K.label);
      if (cur.doc_status === 'C') throw badRequest('เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้');
      const paid = (await sql`SELECT 1 FROM doc_settlement s LEFT JOIN doc_header p ON p.id = s.payment_header_id WHERE s.invoice_header_id = ${id} AND s.deleted_at IS NULL AND coalesce(p.doc_status, 'N') <> 'C' LIMIT 1`.execute(tx)).rows.length;
      if (paid) throw badRequest('บิลนี้มีการรับ/จ่ายชำระแล้ว แก้ไขไม่ได้');
      // มัดจำยกมาที่ใบเสร็จหัก/ใบคืนเงินใช้อยู่ แก้ไม่ได้ (กฎเหล็ก usedBy)
      const used = K.cls === 'AI' ? await usedBy(tx, a.companyId, id) : null;
      if (used) throw badRequest(`แก้ไขไม่ได้ — มี${used.what} ${used.doc_no} อ้างถึงอยู่ ต้องแก้ไขหรือยกเลิก ${used.doc_no} ก่อน`);
      await tx.updateTable('doc_header').set(header).where('id', '=', id).execute();
    } else {
      hid = (await tx.insertInto('doc_header').values({ ...header, company_id: a.companyId, branch_id: branchId!, doc_status: 'N', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    // ลงบัญชีในทรานแซกชันเดียวกัน (กติกาข้อ 6): ใบเดิมที่ลงไว้ = ลงใหม่ในใบสำคัญเดิม · เลิกลงบัญชี = ยกเลิกใบสำคัญเดิม
    const prev = id ? (await tx.selectFrom('gl_journal').select('id').where('company_id', '=', a.companyId).where('source_header_id', '=', id).where('doc_status', '<>', 'C').where('deleted_at', 'is', null).executeTakeFirst())?.id ?? null : null;
    let journalId: string | null = null;
    if (offset) journalId = (await postDocument(tx, a, hid!, prev)).journal_id;
    if (offset && journalId && K.cls === 'IV') await guardKeyedOpening(tx, a.companyId, journalId, offset, b.doc_date);
    else if (prev) await unpostDocument(tx, a, hid!);
    await logActivity(tx, a, { module: K.module, action: id ? 'EDIT' : 'ADD', docNo: b.doc_no, table: 'doc_header', rowId: hid, detail: { opening: true, ...(offset ? { posted: true, offset_account_id: offset, journal_id: journalId } : {}) } });
    return { id: hid, doc_no: b.doc_no, net_amount: net.toFixed(2), journal_id: journalId };
  });
}

export function openingRoutes(app: FastifyInstance, db: Db) {
  for (const K of OPENING_KINDS) {
    const base = `/api/v1/${K.path}`;
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    const partyCol = K.party === 'customer' ? 'customer_id' : 'supplier_id';
    const view = K.cls === 'AI' ? 'v_deposit_outstanding' : K.module === 'AR' ? 'v_ar_outstanding' : 'v_ap_outstanding';
    app.get(base, async (req) => {
      const a = requireCompany(req);
      const q = parse(z.object({ q: z.string().optional(), status: z.enum(['N', 'C', 'all']).default('all'), limit: z.coerce.number().int().min(1).max(2000).default(500) }), req.query);
      const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const rows = (await sql`SELECT h.id, (SELECT b.code FROM sys_branch b WHERE b.id = h.branch_id) AS branch_code, h.doc_no, h.doc_date, h.due_date, h.ref_no, h.party_name, p.code AS party_code, h.net_amount, h.vat_basis, h.doc_status,
          (SELECT o.outstanding FROM ${sql.table(view)} o WHERE o.header_id = h.id) AS outstanding,
          ${K.cls === 'AI' ? sql`(SELECT o.used::numeric(18,2) FROM v_deposit_outstanding o WHERE o.header_id = h.id)` : sql`NULL`} AS used,
          h.source_system, h.source_ref, EXISTS (SELECT 1 FROM gl_journal j WHERE j.source_header_id = h.id AND j.doc_status <> 'C' AND j.deleted_at IS NULL) AS posted
          FROM doc_header h LEFT JOIN ${sql.table(partyTbl)} p ON p.id = h.${sql.ref(partyCol)}
         WHERE h.company_id = ${a.companyId} AND h.doc_class = ${K.cls} AND h.is_opening AND h.deleted_at IS NULL ${a.branchId ? sql`AND h.branch_id = ${a.branchId}` : sql``}
           ${q.status !== 'all' ? sql`AND h.doc_status = ${q.status}` : sql``} ${like ? sql`AND (h.doc_no ILIKE ${like} OR h.party_name ILIKE ${like} OR p.code ILIKE ${like} OR h.ref_no ILIKE ${like} OR h.source_ref ILIKE ${like})` : sql``}
         ORDER BY p.code, h.doc_date, h.doc_no LIMIT ${q.limit}`.execute(db)).rows as Array<{ outstanding: string | null; doc_status: string }>;
      const start = await startDate(db, a.companyId);
      // บัญชีพักยอดยกมา (บทบาท OPENING_BALANCE) = บัญชีคู่ค่าเริ่มต้นของหน้าจอ
      const opening = K.party === 'customer' ? (await sql<{ id: string; account_no: string; name_th: string }>`SELECT g.id, g.account_no, g.name_th FROM gl_default_account x JOIN gl_account g ON g.id = x.account_id
          WHERE x.company_id = ${a.companyId} AND x.role = 'OPENING_BALANCE' AND x.deleted_at IS NULL AND g.deleted_at IS NULL LIMIT 1`.execute(db)).rows[0] ?? null : null;
      return { rows, start_date: start, opening_account: opening, total: rows.filter((r) => r.doc_status !== 'C').reduce((s, r) => s.plus(d(r.outstanding ?? 0)), d(0)).toFixed(2) };
    });
    app.get(`${base}/:id`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const h = await db.selectFrom('doc_header').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      const pc = await db.selectFrom(partyTbl).select('code').where('id', '=', (h.customer_id ?? h.supplier_id)!).executeTakeFirst();
      const settled = (await sql`SELECT coalesce(p.id, j.id) AS id, CASE WHEN p.id IS NULL THEN 'GL' ELSE p.doc_class END AS doc_class, coalesce(p.doc_no, j.voucher_no) AS doc_no, coalesce(p.doc_date, j.voucher_date) AS doc_date, s.amount, coalesce(p.doc_status, j.doc_status) AS doc_status
          FROM doc_settlement s LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
         WHERE s.invoice_header_id = ${id} AND s.deleted_at IS NULL ORDER BY 2`.execute(db)).rows as Array<{ doc_status: string }>;
      const out = (await sql<{ outstanding: string }>`SELECT outstanding FROM ${sql.table(view)} WHERE header_id = ${id}`.execute(db)).rows[0];
      // มัดจำยกมา: ใบเสร็จที่หัก / ใบคืนเงินที่คืน (doc_link DEPOSIT) — รวมที่ยกเลิกแล้ว (แสดงขีดฆ่า ไม่นับยอด)
      const links = K.cls === 'AI' ? (await sql<{ id: string; doc_class: string; doc_no: string; doc_date: string; amount: string; doc_status: string }>`
          SELECT o.id, o.doc_class, o.doc_no, o.doc_date, l.amount, o.doc_status FROM doc_link l JOIN doc_header o ON o.id = l.to_header_id
           WHERE l.from_header_id = ${id} AND l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND o.deleted_at IS NULL ORDER BY o.doc_date, o.doc_no`.execute(db)).rows : [];
      const used = K.cls === 'AI' ? links.filter((x) => x.doc_status !== 'C').reduce((t, x) => t.plus(d(x.amount)), d(0)).toFixed(2) : null;
      const posted = !!(await db.selectFrom('gl_journal').select('id').where('company_id', '=', a.companyId).where('source_header_id', '=', id).where('doc_status', '<>', 'C').where('deleted_at', 'is', null).executeTakeFirst());
      const off = h.opening_offset_account_id ? await db.selectFrom('gl_account').select(['account_no', 'name_th']).where('id', '=', h.opening_offset_account_id).where('company_id', '=', a.companyId).executeTakeFirst() : null;
      const busy = settled.some((x) => x.doc_status !== 'C') || links.some((x) => x.doc_status !== 'C');
      return { ...h, party_code: pc?.code ?? null, settlements: settled, links, used, posted, offset_account: off ?? null, outstanding: out?.outstanding ?? null,
        editable: h.doc_status !== 'C' && !busy && !h.source_system, start_date: await startDate(db, a.companyId) };
    });
    app.post(base, async (req) => save(db, requireCompany(req), K, null, parse(body, req.body)));
    // ตัวอย่างการลงบัญชี (ยอดยกมาที่ลงบัญชี) — บันทึกจริงใน SAVEPOINT แล้วถอยกลับ
    app.post(`${base}/posting-preview`, async (req) => { const a = requireCompany(req); const { id } = parse(previewQuery, req.query); return previewSave(db, a.companyId, (tx) => save(tx, a, K, id ?? null, parse(body, req.body))); });
    app.put(`${base}/:id`, async (req) => save(db, requireCompany(req), K, parse(z.object({ id: uuid }), req.params).id, parse(body, req.body)));
    app.post(`${base}/:id/cancel`, async (req) => {
      const a = requireCompany(req);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผลที่ยกเลิก').max(200) }), req.body);
      const h = await db.selectFrom('doc_header').select('id').where('id', '=', id).where('company_id', '=', a.companyId).where('doc_class', '=', K.cls).where('is_opening', '=', true).where('deleted_at', 'is', null).executeTakeFirst();
      if (!h) throw notFound(K.label);
      return cancelDocument(db, a, id, reason);
    });
  }
}
