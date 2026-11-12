import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { DOC_SLOT_ROLES, LIVING_ACCOUNTS, LIVING_BOOK, LIVING_CUSTOMER_PREFIX, LIVING_DOC_TYPE_ACCOUNT, LIVING_DOC_TYPES, LIVING_ITEMS, LIVING_PAYMENT_METHOD, nextChildAccountNo, type LivingAccountKey } from '@buddy/core';
import type { Db } from '../db.js';
import { forbidden, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';
import { maskRe } from './gl/chart-templates.js';
import { newSpecificCode } from './items.js';

/**
 * ปุ่ม "ตั้งค่าสำหรับ WTS-Living" (HANDOFF ข้อ 86 · docs/17 B5 · docs/07 หัวข้อ "ตั้งค่าสำหรับ WTS-Living")
 *  GET  /api/v1/company/wts-living-setup  รายการตรวจ: มีแล้ว / จะสร้าง / ตั้งค่า + บัญชีที่แต่ละรายการใช้ (ไม่แก้อะไร)
 *  POST /api/v1/company/wts-living-setup  สร้างที่ยังไม่มีตามรายการเดียวกันในทรานแซกชันเดียว + บันทึก log
 * ไม่สร้างซ้ำ ไม่ทับของเดิม: ประเภทเอกสาร/สมุด/วิธีรับชำระ/รหัสรายได้ตรวจด้วยรหัส · บัญชีใช้ของที่ผูกอยู่แล้ว (เช่น บัญชีเงินมัดจำรับของ AIL)
 * หรือบัญชีชื่อเดียวกันในหมวดเดียวกัน ก่อนสร้างใหม่ใต้บัญชีคุมในผังของบริษัท (เลขต่อจากบัญชีพี่น้อง)
 * เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) ของลูกค้าที่เป็นเจ้าของบริษัทนี้ ผ่านหน้าจอ (ไม่รับกุญแจ API) · บริษัทจาก session เท่านั้น
 */
type Ctx = AuthContext & { companyId: string };
export type SetupStatus = 'exists' | 'create' | 'set' | 'blocked';
export interface SetupRow {
  group: 'account' | 'role' | 'book' | 'doc_type' | 'payment_method' | 'item' | 'setting' | 'customer';
  key: string; code: string; name: string; status: SetupStatus;
  account?: { no: string; name: string } | null; note?: string | null;
}
type Acc = { id: string; account_no: string; name_th: string; parent_id: string | null; level: number; account_group: string; is_control: boolean };

const LABEL: Record<LivingAccountKey, string> = {
  deposit: 'เงินประกันผู้เช่า (ช่องบัญชีเงินมัดจำรับของ AIL · วิธีรับชำระหักเงินประกัน)',
  prepaid: 'เงินรับล่วงหน้าจากผู้เช่าและสมาชิก (ช่องบัญชีเงินมัดจำรับของ ADL · ค่าเช่าล่วงหน้า/รับเกินยอดบิล)', advance: 'รายได้ค่าส่วนกลางรับล่วงหน้า (ค่าส่วนกลางรายปี)',
  fund: 'เงินกองทุนจากสมาชิก (หมวด 3)', opening: 'บัญชีพักยอดยกมา (คู่ของลูกหนี้/เงินประกันยกมา)', rent: 'รายได้ค่าเช่า', utility: 'รายได้ค่าน้ำค่าไฟ',
  common: 'รายได้ค่าส่วนกลาง', service: 'รายได้ค่าบริการอื่น', penalty: 'รายได้ค่าปรับ', damage: 'รายได้ค่าเสียหาย',
};

/** ทำรายการตรวจ (apply = false) หรือสร้างตามรายการ (apply = true · ในทรานแซกชันที่ส่งมา) */
async function run(db: Db, a: Ctx, apply: boolean) {
  const co = a.companyId;
  const rows: SetupRow[] = [];
  const created: string[] = [];
  const chart = await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th', 'parent_id', 'level', 'account_group', 'is_control'])
    .where('company_id', '=', co).where('deleted_at', 'is', null).orderBy('account_no').execute() as Acc[];
  const byId = new Map(chart.map((x) => [x.id, x]));
  const taken = new Set(chart.map((x) => x.account_no));
  const roles = new Map((await db.selectFrom('gl_default_account').select(['role', 'account_id']).where('company_id', '=', co).where('deleted_at', 'is', null).execute()).map((r) => [r.role, r.account_id]));
  const settings = await companySettings(db, co);
  const mask = settings['gl.account_mask'] as string | undefined;
  const re = mask ? maskRe(mask) : null;
  const show = (x: Acc | { account_no: string; name_th: string } | null | undefined) => (x ? { no: x.account_no, name: x.name_th } : null);
  const docType = async (code: string) => db.selectFrom('md_doc_type').select(['id', 'doc_class']).where('company_id', '=', co).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
  const slotOf = async (dtId: string, slot: number) => (await db.selectFrom('md_doc_type_account').select('account_id').where('doc_type_id', '=', dtId).where('slot', '=', slot).where('deleted_at', 'is', null).executeTakeFirst())?.account_id ?? null;
  const itemOf = async (code: string) => db.selectFrom('md_item as i').leftJoin('md_item_account_group as g', 'g.id', 'i.account_group_id')
    .select(['i.id', 'i.item_type', 'g.sales_account_id']).where('i.company_id', '=', co).where('i.code', '=', code).where('i.deleted_at', 'is', null).executeTakeFirst();
  const pm = await db.selectFrom('md_payment_method').select(['id', 'gl_account_id']).where('company_id', '=', co).where('direction', '=', 'R').where('code', '=', LIVING_PAYMENT_METHOD.code).where('deleted_at', 'is', null).executeTakeFirst();
  const ail = await docType('AIL');
  const adl = await docType('ADL');

  /* ---- 1 บัญชี ---- */
  const accOf = new Map<LivingAccountKey, { id: string | null; no: string; name: string }>();
  for (const spec of LIVING_ACCOUNTS) {
    // ของที่ผูกอยู่แล้ว: บัญชีเงินมัดจำรับของ AIL / บัญชีของวิธีหักเงินประกัน · บทบาทบัญชีพักยอดยกมา · บัญชีรายได้ของรหัสรายได้ Living
    let linked: string | null = null;
    if (spec.key === 'deposit') linked = (ail ? await slotOf(ail.id, 3) : null) ?? pm?.gl_account_id ?? null;
    else if (spec.key === 'prepaid') linked = adl ? await slotOf(adl.id, 3) : null;
    else if (spec.key === 'opening') linked = roles.get('OPENING_BALANCE') ?? null;
    else {
      const it = LIVING_ITEMS.find((x) => x.account === spec.key);
      linked = it ? (await itemOf(it.code))?.sales_account_id ?? null : null;
    }
    const found = (linked && byId.get(linked)) || chart.find((x) => !x.is_control && x.account_group === spec.group && x.name_th.trim() === spec.name_th);
    if (found) { accOf.set(spec.key, { id: found.id, no: found.account_no, name: found.name_th }); rows.push({ group: 'account', key: spec.key, code: found.account_no, name: LABEL[spec.key], status: 'exists', account: show(found) }); continue; }
    // ใหม่: ใต้บัญชีคุมที่ชื่อขึ้นต้นตามที่กำหนด หรือใต้บัญชีคุมของบัญชีตามบทบาท
    const byName = spec.control ? chart.find((x) => x.is_control && x.account_group === spec.group && x.name_th.trim().startsWith(spec.control!)) : undefined;
    const roleAcc = roles.get(spec.role) ? byId.get(roles.get(spec.role)!) : undefined;
    const parent = byName ?? (roleAcc?.parent_id ? byId.get(roleAcc.parent_id) : undefined);
    const no = parent?.is_control ? nextChildAccountNo(parent.account_no, chart.filter((x) => x.parent_id === parent.id).map((x) => x.account_no), taken) : null;
    if (!parent?.is_control || !no || (re && !re.test(no))) {
      rows.push({ group: 'account', key: spec.key, code: '', name: LABEL[spec.key], status: 'blocked',
        note: `หาที่สร้างบัญชี "${spec.name_th}" ในผังของบริษัทไม่ได้ — เพิ่มบัญชีชื่อนี้เองที่ ผังบัญชี (หมวด ${spec.group}) แล้วกดใหม่` });
      continue;
    }
    taken.add(no);
    let id: string | null = null;
    if (apply) {
      id = (await db.insertInto('gl_account').values({ company_id: co, account_no: no, name_th: spec.name_th, name_en: spec.name_en, parent_id: parent.id, level: parent.level + 1,
        account_group: parent.account_group, is_control: false, normal_side: parent.account_group === '1' || parent.account_group >= '5' ? 'D' : 'C', use_department: false, created_by: a.userId })
        .returning('id').executeTakeFirstOrThrow()).id;
      chart.push({ id, account_no: no, name_th: spec.name_th, parent_id: parent.id, level: parent.level + 1, account_group: parent.account_group, is_control: false });
      byId.set(id, chart[chart.length - 1]!);
      created.push(`account:${no}`);
    }
    accOf.set(spec.key, { id, no, name: spec.name_th });
    rows.push({ group: 'account', key: spec.key, code: no, name: LABEL[spec.key], status: 'create', account: { no, name: spec.name_th }, note: `ใต้บัญชีคุม ${parent.account_no} ${parent.name_th}` });
  }
  const accId = (k: LivingAccountKey) => accOf.get(k)?.id ?? null;
  const accShow = (k: LivingAccountKey) => { const x = accOf.get(k); return x ? { no: x.no, name: x.name } : null; };

  /* ---- 2 บทบาทบัญชีพักยอดยกมา ---- */
  const op = accOf.get('opening');
  if (roles.get('OPENING_BALANCE')) rows.push({ group: 'role', key: 'OPENING_BALANCE', code: 'OPENING_BALANCE', name: 'บทบาท "บัญชีพักยอดยกมา" (การเชื่อมต่อบัญชี)', status: 'exists', account: show(byId.get(roles.get('OPENING_BALANCE')!)) });
  else if (op) {
    if (apply && op.id) { await db.insertInto('gl_default_account').values({ company_id: co, role: 'OPENING_BALANCE', account_id: op.id, created_by: a.userId }).execute(); created.push('role:OPENING_BALANCE'); }
    rows.push({ group: 'role', key: 'OPENING_BALANCE', code: 'OPENING_BALANCE', name: 'บทบาท "บัญชีพักยอดยกมา" (การเชื่อมต่อบัญชี)', status: 'set', account: accShow('opening') });
  }

  /* ---- 3 สมุดรายวัน ---- */
  const books = new Map((await db.selectFrom('gl_journal_book').select(['id', 'code']).where('company_id', '=', co).where('deleted_at', 'is', null).execute()).map((b) => [b.code, b.id]));
  if (books.has(LIVING_BOOK.code)) rows.push({ group: 'book', key: 'book', code: LIVING_BOOK.code, name: LIVING_BOOK.name_th, status: 'exists' });
  else {
    if (apply) { books.set(LIVING_BOOK.code, (await db.insertInto('gl_journal_book').values({ company_id: co, ...LIVING_BOOK, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id); created.push(`book:${LIVING_BOOK.code}`); }
    rows.push({ group: 'book', key: 'book', code: LIVING_BOOK.code, name: `${LIVING_BOOK.name_th} (ใบสำคัญรับรู้ค่าส่วนกลางรายปี · คืนเงินประกันยกมา)`, status: 'create' });
  }

  /* ---- 4 ประเภทเอกสาร ---- */
  for (const t of LIVING_DOC_TYPES) {
    const ex = await docType(t.code);
    const slotAcc = LIVING_DOC_TYPE_ACCOUNT[t.key] ?? null;
    const depositSlot = t.cls === 'AI' && slotAcc ? 3 : null;
    if (ex) {
      const slot = depositSlot ? await slotOf(ex.id, depositSlot) : null;
      rows.push({ group: 'doc_type', key: t.key, code: t.code, name: t.name_th, status: ex.doc_class === t.cls ? 'exists' : 'blocked', account: slot ? show(byId.get(slot)) : depositSlot ? null : undefined,
        note: ex.doc_class !== t.cls ? `รหัส ${t.code} ใช้กับเอกสารหมวด ${ex.doc_class} อยู่แล้ว — WTS-Living ต้องการหมวด ${t.cls} (เลือกประเภทเอกสารเองใน WTS-Living)`
          : depositSlot && !slot ? 'ยังไม่ได้กำหนดบัญชีเงินมัดจำรับ (ช่อง 3) — ใช้บัญชีตามการเชื่อมต่อบัญชี · แก้ที่ เริ่มระบบ › เลขที่เอกสาร' : null });
      continue;
    }
    if (apply) {
      const id = (await db.insertInto('md_doc_type').values({ company_id: co, code: t.code, doc_class: t.cls, module: t.module, name_th: t.name_th, name_en: t.name_en,
        journal_book_id: books.get(t.book) ?? null, vat_basis: t.vat_basis, price_type: t.price_type, is_tax_invoice: t.tax_invoice, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      if (depositSlot && slotAcc && accId(slotAcc))
        await db.insertInto('md_doc_type_account').values({ company_id: co, doc_type_id: id, slot: depositSlot, role: DOC_SLOT_ROLES[t.cls]?.[depositSlot] ?? null, account_id: accId(slotAcc)!, created_by: a.userId }).execute();
      created.push(`doc_type:${t.code}`);
    }
    rows.push({ group: 'doc_type', key: t.key, code: t.code, name: t.name_th, status: 'create', account: depositSlot && slotAcc ? accShow(slotAcc) : undefined,
      note: t.cls === 'IV' ? 'ภาษีเกณฑ์เงินสด (ถึงกำหนดเมื่อรับชำระ) · ราคาแยก VAT' : t.cls === 'RE' ? 'ใบกำกับภาษีตัวจริงของค่าเช่า/ค่าบริการ (docs/19 ข้อ 3)'
        : t.key === 'adv' ? 'ค่าเช่าล่วงหน้า/รับเงินเกินยอดบิล ไม่มี VAT · หักในใบเสร็จของบิลถัดไป เหลือคืนด้วยใบคืนเงิน' : null });
  }

  /* ---- 5 วิธีรับชำระ "หักเงินประกัน" ---- */
  if (pm) rows.push({ group: 'payment_method', key: 'deposit_method', code: LIVING_PAYMENT_METHOD.code, name: LIVING_PAYMENT_METHOD.name_th, status: 'exists', account: pm.gl_account_id ? show(byId.get(pm.gl_account_id)) : null });
  else {
    if (apply && accId('deposit')) {
      const seq = (await sql<{ n: number | null }>`SELECT max(CASE WHEN seq ~ '^[0-9]+$' THEN seq::int END) AS n FROM md_payment_method WHERE company_id = ${co} AND direction = 'R' AND deleted_at IS NULL`.execute(db)).rows[0]?.n ?? 0;
      await db.insertInto('md_payment_method').values({ company_id: co, direction: 'R', code: LIVING_PAYMENT_METHOD.code, seq: String(Number(seq) + 1).padStart(2, '0'), name_th: LIVING_PAYMENT_METHOD.name_th, name_en: LIVING_PAYMENT_METHOD.name_en,
        kind: 'OTHER', gl_account_id: accId('deposit'), created_by: a.userId }).execute();
      created.push(`payment_method:${LIVING_PAYMENT_METHOD.code}`);
    }
    rows.push({ group: 'payment_method', key: 'deposit_method', code: LIVING_PAYMENT_METHOD.code, name: LIVING_PAYMENT_METHOD.name_th, status: accOf.has('deposit') ? 'create' : 'blocked', account: accShow('deposit') });
  }

  /* ---- 6 รหัสรายได้ต่อชนิดรายการเรียกเก็บ ---- */
  for (const it of LIVING_ITEMS) {
    const ex = await itemOf(it.code);
    if (ex) { rows.push({ group: 'item', key: it.code, code: it.code, name: it.name_th, status: 'exists', account: ex.sales_account_id ? show(byId.get(ex.sales_account_id)) : null, note: ex.sales_account_id ? null : 'ไม่ได้กำหนดบัญชีรายได้ — ใช้บัญชีขายเชื่อตามการเชื่อมต่อบัญชี' }); continue; }
    if (apply && accId(it.account)) {
      const iid = (await db.insertInto('md_item').values({ company_id: co, code: it.code, name_th: it.name_th, name_en: it.name_en, item_type: '3', vat_code: it.vat_code, status: 'A', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      const g = await db.insertInto('md_item_account_group').values({ company_id: co, code: await newSpecificCode(db, co), name_th: it.name_th, name_en: it.name_en, item_specific: true, sales_account_id: accId(it.account), created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await db.updateTable('md_item').set({ account_group_id: g.id }).where('id', '=', iid).execute();
      created.push(`item:${it.code}`);
    }
    rows.push({ group: 'item', key: it.code, code: it.code, name: `${it.name_th} (${it.charges.join(' ')})`, status: accOf.has(it.account) ? 'create' : 'blocked', account: accShow(it.account), note: it.vat_code === '1' ? 'มี VAT 7%' : 'ยกเว้น VAT' });
  }

  /* ---- 7 ค่าตั้ง + ลูกค้าของผู้เช่า ---- */
  if (settings['gen.allow_blank_party_tax_id'] === true) rows.push({ group: 'setting', key: 'gen.allow_blank_party_tax_id', code: 'gen.allow_blank_party_tax_id', name: 'ยอมให้เลขผู้เสียภาษีว่างได้ (ผู้เช่าบุคคลธรรมดา)', status: 'exists' });
  else {
    if (apply) { await setSetting(db, co, 'gen.allow_blank_party_tax_id', true, a.userId); created.push('setting:gen.allow_blank_party_tax_id'); }
    rows.push({ group: 'setting', key: 'gen.allow_blank_party_tax_id', code: 'gen.allow_blank_party_tax_id', name: 'ยอมให้เลขผู้เสียภาษีว่างได้ (ผู้เช่าบุคคลธรรมดา)', status: 'set' });
  }
  const lv = Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM md_customer WHERE company_id = ${co} AND code LIKE ${`${LIVING_CUSTOMER_PREFIX}%`} AND deleted_at IS NULL`.execute(db)).rows[0]!.n);
  rows.push({ group: 'customer', key: 'customer_prefix', code: `${LIVING_CUSTOMER_PREFIX}…`, name: 'ลูกค้าของผู้เช่า/เจ้าของแปลง — WTS-Living สร้างเองตอนส่งเอกสารแรก (LV<รหัสผู้ติดต่อ>)', status: 'exists',
    note: lv ? `มีลูกค้ารหัส ${LIVING_CUSTOMER_PREFIX}… แล้ว ${lv} ราย` : 'ยังไม่มี' });
  return { rows, created };
}

function guard(req: Parameters<typeof requireCompany>[0]) {
  const a = requireCompany(req);
  if (a.apiKeyId) throw forbidden('ตั้งค่าสำหรับ WTS-Living ทำที่หน้าจอ Buddy โดยผู้ดูแลระบบเท่านั้น (ไม่รับกุญแจ API)');
  if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) ของบริษัทนี้ — ให้ผู้ดูแลระบบเป็นผู้กด "ตั้งค่าสำหรับ WTS-Living"');
  return a;
}
const summary = (rows: SetupRow[]) => ({
  create: rows.filter((r) => r.status === 'create' || r.status === 'set').length,
  exists: rows.filter((r) => r.status === 'exists').length,
  blocked: rows.filter((r) => r.status === 'blocked').length,
});

export function wtsLivingRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/company/wts-living-setup', async (req) => {
    const a = guard(req);
    const { rows } = await run(db, a, false);
    return { rows, ...summary(rows) };
  });
  app.post('/api/v1/company/wts-living-setup', async (req) => {
    const a = guard(req);
    return db.transaction().execute(async (tx) => {
      // ทำซ้ำรายการตรวจในทรานแซกชัน (ข้อมูลล่าสุด) แล้วสร้างตามนั้น — รายการที่มีแล้วไม่ถูกแก้
      const { rows, created } = await run(tx, a, true);
      await logActivity(tx, a, { module: 'SYS', action: 'WTS_LIVING_SETUP', table: 'sys_company', rowId: a.companyId, detail: { created } });
      return { rows, created, ...summary(rows) };
    });
  });
}
