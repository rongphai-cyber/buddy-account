import type { FastifyInstance } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { formatDate, PDPA_ERASED, PDPA_REGISTER, pdpaCanFullErase, pdpaRetainUntil } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * T0.17 PDPA — ทะเบียนข้อมูลส่วนบุคคล (ม.39) และคำขอของเจ้าของข้อมูลในบริษัทปัจจุบัน
 * - ค้นหาเจ้าของข้อมูล (ลูกค้า ผู้จำหน่าย พนักงานขาย ผู้ติดต่อ) → รายงานข้อมูลที่เก็บไว้ทั้งหมด (ขอดู/ขอรับสำเนา ม.30–31)
 * - ลบข้อมูลติดต่อได้ทันที · ปิดบังชื่อ/ที่อยู่/เลขผู้เสียภาษีในแฟ้มหลักและเอกสารได้เมื่อพ้นระยะเก็บเอกสาร 5 ปี (ม.33)
 * - ทุกคำขอบันทึกใน sys_pdpa_request + sys_activity_log โดยไม่เก็บค่าข้อมูลที่ลบ
 * การลบทั้งลูกค้าผู้ใช้บริการเมื่อเลิกใช้บริการอยู่ใน company.ts (/tenants/:id/purge)
 */
const KINDS = ['CUSTOMER', 'SUPPLIER', 'SALESPERSON', 'CONTACT'] as const;
type Kind = (typeof KINDS)[number];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const subjectParams = z.object({ kind: z.enum(KINDS), id: z.string().uuid() });
/** วันที่วันนี้ตามเวลาประเทศไทย */
const bkkToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type Row = Record<string, unknown>;
const rows = async <T = Row>(db: Db, q: RawBuilder<unknown>) => (await q.execute(db)).rows as T[];

/** ข้อมูลทั้งหมดของเจ้าของข้อมูลหนึ่งราย + ระยะที่ต้องเก็บ */
async function subjectReport(db: Db, companyId: string, kind: Kind, id: string) {
  const one = async (t: string) => (await rows(db, sql`SELECT * FROM ${sql.id(t)} WHERE company_id = ${companyId} AND id = ${id}`))[0];
  const master = kind === 'CUSTOMER' ? await one('md_customer') : kind === 'SUPPLIER' ? await one('md_supplier') : kind === 'SALESPERSON' ? await one('md_salesperson') : await one('md_party_contact');
  if (!master) throw notFound('เจ้าของข้อมูล');
  const pick = (table: string, r: Row) => {
    const cols = ['id', 'code', 'status', ...PDPA_REGISTER.filter((e) => e.table === table).flatMap((e) => e.columns)];
    return Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]));
  };
  const out: Row = { kind, generated_at: new Date().toISOString() };
  let code = String(master.code ?? '');
  let docs: { n: number; first: string | null; last: string | null } = { n: 0, first: null, last: null };
  let docList: Row[] = [];
  const dates: (string | null)[] = [];
  if (kind === 'CONTACT') {
    const party = master.party_type === 'C' ? 'md_customer' : 'md_supplier';
    const p = (await rows<{ code: string; name: string }>(db, sql`SELECT code, name FROM ${sql.id(party)} WHERE company_id = ${companyId} AND id = ${master.party_id}`))[0];
    code = p?.code ?? '';
    out.master = { ...pick('md_party_contact', master), party_type: master.party_type, party_code: p?.code ?? null, party_name: p?.name ?? null };
  } else {
    const table = kind === 'CUSTOMER' ? 'md_customer' : kind === 'SUPPLIER' ? 'md_supplier' : 'md_salesperson';
    out.master = pick(table, master);
    const docWhere = kind === 'CUSTOMER' ? sql`(customer_id = ${id} OR bill_to_customer_id = ${id})` : kind === 'SUPPLIER' ? sql`supplier_id = ${id}` : sql`salesperson_id = ${id}`;
    docs = (await rows<typeof docs>(db, sql`SELECT count(*)::int AS n, min(doc_date)::text AS first, max(doc_date)::text AS last FROM doc_header WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${docWhere}`))[0]!;
    docList = await rows(db, sql`SELECT doc_no, doc_date::text AS doc_date, doc_class, doc_status, party_name, party_tax_id FROM doc_header WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${docWhere} ORDER BY doc_date DESC, doc_no DESC LIMIT 500`);
    dates.push(docs.last);
    if (kind !== 'SALESPERSON') {
      const pt = kind === 'CUSTOMER' ? 'C' : 'S';
      const col = kind === 'CUSTOMER' ? sql`customer_id` : sql`supplier_id`;
      out.contacts = await rows(db, sql`SELECT line_no, name, position, phone, email, is_primary FROM md_party_contact WHERE company_id = ${companyId} AND party_type = ${pt} AND party_id = ${id} AND deleted_at IS NULL ORDER BY line_no`);
      out.notes = await rows(db, sql`SELECT seq, text FROM md_note WHERE company_id = ${companyId} AND entity_type = ${kind} AND entity_id = ${id} AND deleted_at IS NULL ORDER BY seq`);
      const wht = (await rows<{ n: number; last: string | null }>(db, sql`SELECT count(*)::int AS n, max(certificate_date)::text AS last FROM tax_wht_entry WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${col} = ${id}`))[0]!;
      const chq = (await rows<{ n: number; last: string | null }>(db, sql`SELECT count(*)::int AS n, max(cheque_date)::text AS last FROM fin_cheque WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${col} = ${id}`))[0]!;
      const vat = (await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM tax_vat_entry v WHERE v.company_id = ${companyId} AND v.deleted_at IS NULL
          AND v.header_id IN (SELECT h.id FROM doc_header h WHERE h.company_id = ${companyId} AND ${docWhere})`))[0]!;
      out.tax = { vat_entries: vat.n, wht_entries: wht.n, cheques: chq.n };
      dates.push(wht.last, chq.last);
      if (kind === 'CUSTOMER') {
        out.ship_to = await rows(db, sql`SELECT code, address_1, address_2, address_3, zip_code, phone, contact FROM md_customer_ship_to WHERE company_id = ${companyId} AND customer_id = ${id} AND deleted_at IS NULL ORDER BY code`);
        const ser = (await rows<{ n: number; last: string | null }>(db, sql`SELECT count(*)::int AS n, max(sale_date)::text AS last FROM md_serial WHERE company_id = ${companyId} AND deleted_at IS NULL AND customer_id = ${id}`))[0]!;
        out.serials = ser.n;
        dates.push(ser.last);
      } else {
        out.bank_accounts = await rows(db, sql`SELECT line_no, bank_code, branch, account_no, account_name FROM md_supplier_bank WHERE company_id = ${companyId} AND supplier_id = ${id} AND deleted_at IS NULL ORDER BY line_no`);
      }
    }
  }
  const last = dates.filter((d): d is string => !!d).sort().at(-1) ?? null;
  const fy = last ? (await rows<{ e: string }>(db, sql`SELECT end_date::text AS e FROM gl_fiscal_year WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${last}::date BETWEEN start_date AND end_date LIMIT 1`))[0]?.e : null;
  const retainUntil = kind === 'CONTACT' ? null : pdpaRetainUntil(last, fy);
  out.documents = { count: docs.n, first_date: docs.first, last_date: docs.last, list: docList, truncated: docs.n > docList.length };
  out.retention = { last_activity: last, retain_until: retainUntil, full_erase_allowed: pdpaCanFullErase(bkkToday(), retainUntil) };
  return { code, report: out };
}

/** ลบข้อมูลติดต่อ (ทำได้ทันที) — คืนจำนวนแถวที่เปลี่ยนต่อตาราง */
async function eraseContact(db: Db, companyId: string, kind: Kind, id: string, userId: string) {
  const n: Record<string, number> = {};
  const run = async (t: string, q: RawBuilder<unknown>) => { const r = await q.execute(db); n[t] = (n[t] ?? 0) + Number(r.numAffectedRows ?? 0); };
  const erasedContacts = (pt: string) => sql`UPDATE md_party_contact SET name = ${PDPA_ERASED}, position = NULL, phone = NULL, email = NULL, is_primary = false,
      deleted_at = coalesce(deleted_at, now()), updated_by = ${userId} WHERE company_id = ${companyId} AND party_type = ${pt} AND party_id = ${id}`;
  const erasedNotes = sql`UPDATE md_note SET text = ${PDPA_ERASED}, deleted_at = coalesce(deleted_at, now()), updated_by = ${userId} WHERE company_id = ${companyId} AND entity_type = ${kind} AND entity_id = ${id}`;
  if (kind === 'CUSTOMER') {
    await run('md_customer', sql`UPDATE md_customer SET phone = NULL, email = NULL, contact = NULL, remark = NULL, updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
    await run('md_customer_ship_to', sql`UPDATE md_customer_ship_to SET phone = NULL, contact = NULL, updated_by = ${userId} WHERE company_id = ${companyId} AND customer_id = ${id}`);
    await run('md_party_contact', erasedContacts('C'));
    await run('md_note', erasedNotes);
  } else if (kind === 'SUPPLIER') {
    await run('md_supplier', sql`UPDATE md_supplier SET phone = NULL, contact = NULL, remark = NULL, updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
    await run('md_supplier_bank', sql`UPDATE md_supplier_bank SET account_no = '-', account_name = NULL, branch = NULL, is_default = false, deleted_at = coalesce(deleted_at, now()), updated_by = ${userId}
        WHERE company_id = ${companyId} AND supplier_id = ${id}`);
    await run('md_party_contact', erasedContacts('S'));
    await run('md_note', erasedNotes);
  } else if (kind === 'SALESPERSON') {
    await run('md_salesperson', sql`UPDATE md_salesperson SET address = NULL, zip_code = NULL, phone = NULL, tax_id = NULL, social_security_no = NULL, updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
  } else {
    await run('md_party_contact', sql`UPDATE md_party_contact SET name = ${PDPA_ERASED}, position = NULL, phone = NULL, email = NULL, is_primary = false,
        deleted_at = coalesce(deleted_at, now()), updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
  }
  return n;
}

/** ปิดบังทั้งหมด (พ้นระยะเก็บแล้ว): ชื่อ ที่อยู่ เลขผู้เสียภาษี ในแฟ้มหลักและเอกสารทุกใบ (งวดที่ปิดแล้วก็แก้เฉพาะช่องเหล่านี้) */
async function eraseFull(db: Db, companyId: string, kind: Kind, id: string, userId: string, today: string) {
  const n = await eraseContact(db, companyId, kind, id, userId);
  if (kind === 'CONTACT') return n;
  const run = async (t: string, q: RawBuilder<unknown>) => { const r = await q.execute(db); n[t] = (n[t] ?? 0) + Number(r.numAffectedRows ?? 0); };
  if (kind === 'SALESPERSON') {
    await run('md_salesperson', sql`UPDATE md_salesperson SET name = ${PDPA_ERASED}, position = NULL, status = 'I', updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
    return n;
  }
  const master = kind === 'CUSTOMER' ? 'md_customer' : 'md_supplier';
  const col = kind === 'CUSTOMER' ? sql`customer_id` : sql`supplier_id`;
  const docWhere = kind === 'CUSTOMER' ? sql`(customer_id = ${id} OR bill_to_customer_id = ${id})` : sql`supplier_id = ${id}`;
  await run(master, sql`UPDATE ${sql.id(master)} SET title = NULL, name = ${PDPA_ERASED}, name_en = NULL, address_1 = NULL, address_2 = NULL, address_3 = NULL, zip_code = NULL,
      tax_id = NULL, tax_branch_no = NULL, status = 'I', inactive_date = coalesce(inactive_date, ${today}::date), updated_by = ${userId} WHERE company_id = ${companyId} AND id = ${id}`);
  if (kind === 'CUSTOMER') {
    await run('md_customer_ship_to', sql`UPDATE md_customer_ship_to SET address_1 = NULL, address_2 = NULL, address_3 = NULL, zip_code = NULL WHERE company_id = ${companyId} AND customer_id = ${id}`);
    await run('md_serial', sql`UPDATE md_serial SET customer_name = NULL WHERE company_id = ${companyId} AND customer_id = ${id}`);
  } else {
    await run('fin_cheque', sql`UPDATE fin_cheque SET payee_name = ${PDPA_ERASED} WHERE company_id = ${companyId} AND supplier_id = ${id} AND payee_name IS NOT NULL`);
  }
  // เอกสารเก่าอยู่ในงวดที่ปิดแล้ว — อนุญาตเฉพาะในทรานแซกชันนี้ แล้วปิดกลับ
  await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(db);
  await run('doc_header', sql`UPDATE doc_header SET party_name = CASE WHEN party_name IS NULL THEN NULL ELSE ${PDPA_ERASED} END, party_address = NULL, party_tax_id = NULL, party_tax_branch_no = NULL
      WHERE company_id = ${companyId} AND ${docWhere}`);
  await sql`SELECT set_config('app.allow_locked_period', 'off', true)`.execute(db);
  await run('tax_vat_entry', sql`UPDATE tax_vat_entry SET party_name = ${PDPA_ERASED}, party_tax_id = NULL, party_tax_branch_no = NULL
      WHERE company_id = ${companyId} AND header_id IN (SELECT h.id FROM doc_header h WHERE h.company_id = ${companyId} AND ${docWhere})`);
  await run('tax_wht_entry', sql`UPDATE tax_wht_entry SET payee_name = ${PDPA_ERASED}, payee_address = NULL, payee_tax_id = NULL, payee_tax_branch_no = NULL
      WHERE company_id = ${companyId} AND (${col} = ${id} OR header_id IN (SELECT h.id FROM doc_header h WHERE h.company_id = ${companyId} AND ${docWhere}))`);
  return n;
}

export function pdpaRoutes(app: FastifyInstance, db: Db) {
  /** ทะเบียนข้อมูลส่วนบุคคล + จำนวนแถวที่มีข้อมูลในบริษัทนี้ */
  app.get('/api/v1/pdpa/register', async (req) => {
    const a = requireCompany(req);
    const cols = await rows<{ t: string; c: string }>(db, sql`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('company_id', 'deleted_at')`);
    const has = (t: string, c: string) => cols.some((r) => r.t === t && r.c === c);
    const out = [];
    for (const e of PDPA_REGISTER) {
      let count: number | null = null;
      if (has(e.table, 'company_id')) {
        const any = sql.join(e.columns.map((c) => sql`${sql.id(c)} IS NOT NULL`), sql` OR `);
        const live = has(e.table, 'deleted_at') ? sql`AND deleted_at IS NULL` : sql``;
        count = (await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM ${sql.id(e.table)} WHERE company_id = ${a.companyId} ${live} AND (${any})`))[0]!.n;
      }
      out.push({ ...e, count });
    }
    return out;
  });

  /** ค้นหาเจ้าของข้อมูลจากรหัส ชื่อ เลขผู้เสียภาษี โทรศัพท์ หรืออีเมล */
  app.get('/api/v1/pdpa/subjects', async (req) => {
    const a = requireCompany(req);
    const { q } = parse(z.object({ q: z.string().trim().min(2, 'ป้อนอย่างน้อย 2 ตัวอักษร').max(100) }), req.query);
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const c = a.companyId;
    return rows(db, sql`
      (SELECT 'CUSTOMER' AS kind, id, code, name, tax_id, phone, email, status FROM md_customer WHERE company_id = ${c} AND deleted_at IS NULL
        AND (code ILIKE ${like} OR name ILIKE ${like} OR tax_id ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like} OR contact ILIKE ${like}) ORDER BY code LIMIT 50)
      UNION ALL
      (SELECT 'SUPPLIER', id, code, name, tax_id, phone, NULL, status FROM md_supplier WHERE company_id = ${c} AND deleted_at IS NULL
        AND (code ILIKE ${like} OR name ILIKE ${like} OR tax_id ILIKE ${like} OR phone ILIKE ${like} OR contact ILIKE ${like}) ORDER BY code LIMIT 50)
      UNION ALL
      (SELECT 'SALESPERSON', id, code, name, tax_id, phone, NULL, status FROM md_salesperson WHERE company_id = ${c} AND deleted_at IS NULL
        AND (code ILIKE ${like} OR name ILIKE ${like} OR tax_id ILIKE ${like} OR phone ILIKE ${like}) ORDER BY code LIMIT 50)
      UNION ALL
      (SELECT 'CONTACT', pc.id, coalesce(cu.code, su.code), pc.name, NULL, pc.phone, pc.email, 'A' FROM md_party_contact pc
        LEFT JOIN md_customer cu ON pc.party_type = 'C' AND cu.id = pc.party_id LEFT JOIN md_supplier su ON pc.party_type = 'S' AND su.id = pc.party_id
        WHERE pc.company_id = ${c} AND pc.deleted_at IS NULL AND (pc.name ILIKE ${like} OR pc.phone ILIKE ${like} OR pc.email ILIKE ${like}) ORDER BY pc.name LIMIT 50)`);
  });

  /** ข้อมูลที่เก็บไว้ทั้งหมดของเจ้าของข้อมูล (ดูบนจอ — ไม่บันทึกเป็นคำขอ) */
  app.get('/api/v1/pdpa/subjects/:kind/:id', async (req) => {
    const a = requireCompany(req);
    const p = parse(subjectParams, req.params);
    return (await subjectReport(db, a.companyId, p.kind, p.id)).report;
  });

  /** ขอดู/ขอรับสำเนา/ขอโอนย้าย: บันทึกคำขอแล้วคืนรายงาน (หน้าจอบันทึกเป็นแฟ้ม JSON ให้เจ้าของข้อมูล) */
  app.post('/api/v1/pdpa/subjects/:kind/:id/access', async (req) => {
    const a = requireCompany(req);
    const p = parse(subjectParams, req.params);
    const b = parse(z.object({ received_on: isoDate, request_type: z.enum(['ACCESS', 'PORT']).default('ACCESS') }), req.body ?? {});
    const { code, report } = await subjectReport(db, a.companyId, p.kind, p.id);
    const r = await db.insertInto('sys_pdpa_request').values({ company_id: a.companyId, request_type: b.request_type, subject_type: p.kind, subject_id: p.id, subject_code: code || null,
      received_on: b.received_on, status: 'D', completed_on: bkkToday(), result: JSON.stringify({ documents: (report.documents as { count: number }).count }), created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SEC', action: 'PDPA_ACCESS', docNo: code || null, table: 'sys_pdpa_request', rowId: r.id, detail: { kind: p.kind, request_type: b.request_type } });
    return { request_id: r.id, report };
  });

  /**
   * ขอลบ: mode CONTACT = ลบข้อมูลติดต่อ (ได้เสมอ) · FULL = ปิดบังทั้งหมด (ต้องพ้นระยะเก็บเอกสาร)
   * ยืนยันด้วยรหัสของเจ้าของข้อมูล (ผู้ติดต่อ = รหัสคู่ค้า) — ไม่ผ่านเงื่อนไขกฎหมาย = 400 พร้อมวันที่ลบได้ (บันทึกการปฏิเสธได้ที่ /pdpa/requests)
   */
  app.post('/api/v1/pdpa/subjects/:kind/:id/erase', async (req) => {
    const a = requireCompany(req);
    const p = parse(subjectParams, req.params);
    const b = parse(z.object({ mode: z.enum(['CONTACT', 'FULL']), received_on: isoDate, confirm: z.string().trim().max(30) }), req.body);
    const { code, report } = await subjectReport(db, a.companyId, p.kind, p.id);
    if (b.confirm.toUpperCase() !== code.toUpperCase()) throw badRequest(`ป้อนรหัส ${code} เพื่อยืนยันการลบข้อมูล (ลบแล้วเรียกคืนไม่ได้)`);
    const ret = report.retention as { retain_until: string | null; full_erase_allowed: boolean };
    const today = bkkToday();
    if (b.mode === 'FULL' && !ret.full_erase_allowed) {
      const ys = ((await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirst())?.year_system ?? 'B') as 'B' | 'C';
      throw badRequest(`ยังปิดบังชื่อ/ที่อยู่/เลขผู้เสียภาษีไม่ได้ — กฎหมายบัญชีและภาษีให้เก็บเอกสารถึง ${formatDate(ret.retain_until, ys)} (5 ปีนับจากสิ้นปีบัญชีของเอกสารล่าสุด) · ลบเฉพาะข้อมูลติดต่อได้ หรือบันทึกคำขอเป็น "ปฏิเสธ" พร้อมเหตุผลนี้`);
    }
    const n = b.mode === 'FULL' ? await eraseFull(db, a.companyId, p.kind, p.id, a.userId, today) : await eraseContact(db, a.companyId, p.kind, p.id, a.userId);
    const r = await db.insertInto('sys_pdpa_request').values({ company_id: a.companyId, request_type: 'ERASE', subject_type: p.kind, subject_id: p.id, subject_code: code || null,
      received_on: b.received_on, status: 'D', erase_mode: b.mode, completed_on: today, result: JSON.stringify(n), created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SEC', action: 'PDPA_ERASE', docNo: code || null, table: 'sys_pdpa_request', rowId: r.id, detail: { kind: p.kind, mode: b.mode, rows: n } });
    return { request_id: r.id, mode: b.mode, rows: n };
  });

  /** ทะเบียนคำขอ (ม.39 — รวมคำขอที่ปฏิเสธพร้อมเหตุผล) */
  app.get('/api/v1/pdpa/requests', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('sys_pdpa_request as r').leftJoin('sys_user as u', 'u.id', 'r.created_by')
      .select(['r.id', 'r.request_type', 'r.subject_type', 'r.subject_code', sql<string>`r.received_on::text`.as('received_on'), 'r.status', 'r.erase_mode', 'r.reason', 'r.result',
        sql<string | null>`r.completed_on::text`.as('completed_on'), 'r.created_at', 'u.username'])
      .where('r.company_id', '=', a.companyId).where('r.deleted_at', 'is', null).orderBy('r.received_on', 'desc').orderBy('r.created_at', 'desc').limit(1000).execute();
  });
  /** บันทึกคำขอเอง: ปฏิเสธ (พร้อมเหตุผล) · ขอแก้ไข (แก้ที่หน้าลูกค้า/ผู้จำหน่ายแล้วบันทึกไว้) · คัดค้าน/ระงับใช้ · รอดำเนินการ */
  const reqBody = z.object({
    request_type: z.enum(['ACCESS', 'PORT', 'RECTIFY', 'ERASE', 'OBJECT']), subject_type: z.enum(KINDS), subject_id: z.string().uuid().nullable().optional(),
    received_on: isoDate, status: z.enum(['O', 'D', 'R']), reason: z.string().trim().max(200).nullable().optional(), completed_on: isoDate.nullable().optional(),
  }).refine((b) => b.status !== 'R' || !!b.reason, { message: 'คำขอที่ปฏิเสธต้องระบุเหตุผล (กฎหมายให้บันทึกเหตุผลไว้)', path: ['reason'] });
  const codeOf = async (companyId: string, kind: Kind, id: string | null | undefined) => {
    if (!id) return null;
    const { code } = await subjectReport(db, companyId, kind, id);
    return code || null;
  };
  app.post('/api/v1/pdpa/requests', async (req) => {
    const a = requireCompany(req);
    const b = parse(reqBody, req.body);
    const code = await codeOf(a.companyId, b.subject_type, b.subject_id);
    const r = await db.insertInto('sys_pdpa_request').values({ company_id: a.companyId, request_type: b.request_type, subject_type: b.subject_type, subject_id: b.subject_id ?? null, subject_code: code,
      received_on: b.received_on, status: b.status, reason: b.reason ?? null, completed_on: b.status === 'O' ? null : (b.completed_on ?? bkkToday()), created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
    await logActivity(db, a, { module: 'SEC', action: 'PDPA_REQUEST', docNo: code, table: 'sys_pdpa_request', rowId: r.id, detail: { type: b.request_type, status: b.status } });
    return r;
  });
  /** ปิดคำขอที่รอดำเนินการ (ดำเนินการแล้ว/ปฏิเสธ) */
  app.put('/api/v1/pdpa/requests/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ status: z.enum(['D', 'R']), reason: z.string().trim().max(200).nullable().optional() }).refine((x) => x.status !== 'R' || !!x.reason, { message: 'คำขอที่ปฏิเสธต้องระบุเหตุผล', path: ['reason'] }), req.body);
    const cur = await db.selectFrom('sys_pdpa_request').select(['status', 'subject_code']).where('company_id', '=', a.companyId).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('คำขอ');
    if (cur.status !== 'O') throw badRequest('คำขอนี้ปิดไปแล้ว — บันทึกคำขอใหม่แทน');
    await db.updateTable('sys_pdpa_request').set({ status: b.status, reason: b.reason ?? null, completed_on: bkkToday(), updated_by: a.userId }).where('company_id', '=', a.companyId).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'SEC', action: 'PDPA_REQUEST', docNo: cur.subject_code, table: 'sys_pdpa_request', rowId: id, detail: { status: b.status } });
    return { id };
  });
}

/**
 * ลบข้อมูลทั้งหมดของลูกค้าผู้ใช้บริการที่เลิกใช้บริการ (DPA: คืน/ลบข้อมูลเมื่อสิ้นสุดสัญญา) — ทรานแซกชันเดียว
 * ลบ: ทุกตารางที่มี company_id ของทุกบริษัทของลูกค้า · การเข้าระบบ/2FA/การผูกบริษัทของผู้ใช้
 * คงไว้ (ปิดบังแล้ว): แถวบริษัท ผู้ใช้ ลูกค้า และเครื่อง/สาขาที่แฟ้มบันทึกเหตุการณ์อ้างถึง — แฟ้มบันทึกเหตุการณ์เพิ่มได้อย่างเดียว ไม่ลบ
 */
const PURGE_KEEP = new Set(['sys_activity_log', 'sys_company', 'sys_device', 'sys_branch']);
export async function purgeTenant(db: Db, tenantId: string) {
  return db.transaction().execute(async (tx) => {
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
    const companies = (await tx.selectFrom('sys_company').select('id').where('tenant_id', '=', tenantId).execute()).map((c) => c.id);
    const users = (await tx.selectFrom('sys_user').select('id').where('tenant_id', '=', tenantId).execute()).map((u) => u.id);
    const n: Record<string, number> = {};
    const count = (t: string, r: { numAffectedRows?: bigint }) => { const k = Number(r.numAffectedRows ?? 0); if (k) n[t] = (n[t] ?? 0) + k; };
    const none = '00000000-0000-0000-0000-000000000000';
    const cs = sql.join((companies.length ? companies : [none]).map((c) => sql`${c}::uuid`));
    const us = sql.join((users.length ? users : [none]).map((u) => sql`${u}::uuid`));
    const tables = (await rows<{ t: string }>(tx, sql`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND x.table_type = 'BASE TABLE' ORDER BY c.table_name`)).map((r) => r.t).filter((t) => !PURGE_KEEP.has(t));
    for (const t of tables) count(t, await sql`DELETE FROM ${sql.id(t)} WHERE company_id IN (${cs})`.execute(tx));
    // เครื่อง/สาขาที่แฟ้มบันทึกเหตุการณ์อ้างถึงต้องคงแถวไว้ (ปิดบังชื่อ) ที่เหลือลบ
    count('sys_device', await sql`DELETE FROM sys_device WHERE company_id IN (${cs}) AND id NOT IN (SELECT device_id FROM sys_activity_log WHERE device_id IS NOT NULL)`.execute(tx));
    await sql`UPDATE sys_device SET name = ${PDPA_ERASED}, public_key = NULL, status = 'I' WHERE company_id IN (${cs})`.execute(tx);
    await sql`UPDATE sys_session SET current_company_id = NULL, current_branch_id = NULL WHERE current_company_id IN (${cs})`.execute(tx);
    count('sys_branch', await sql`DELETE FROM sys_branch WHERE company_id IN (${cs}) AND id NOT IN (SELECT branch_id FROM sys_device WHERE company_id IN (${cs}))`.execute(tx));
    await sql`UPDATE sys_branch SET name = ${PDPA_ERASED}, address = NULL, default_warehouse_id = NULL, status = 'I' WHERE company_id IN (${cs})`.execute(tx);
    // ผู้ใช้: ลบการเข้าระบบ/2FA/การผูกบริษัท แล้วปิดบังชื่อ (คงแถวไว้เพราะเอกสารเดิม/แฟ้มบันทึกเหตุการณ์อ้างถึง)
    count('sys_session', await sql`DELETE FROM sys_session WHERE user_id IN (${us})`.execute(tx));
    count('sys_user_security', await sql`DELETE FROM sys_user_security WHERE user_id IN (${us})`.execute(tx));
    count('sys_user_company', await sql`DELETE FROM sys_user_company WHERE user_id IN (${us})`.execute(tx));
    count('sys_user', await sql`UPDATE sys_user SET username = 'purged_' || substr(replace(id::text, '-', ''), 1, 16), display_name = ${PDPA_ERASED}, password_hash = NULL, default_printer = NULL,
        status = 'I', deleted_at = coalesce(deleted_at, now()) WHERE id IN (${us})`.execute(tx));
    count('sys_company', await sql`UPDATE sys_company SET name_th = ${PDPA_ERASED} || ' (' || code || ')', name_en = NULL, address_th = NULL, address_en = NULL, phone = NULL, tax_id = NULL,
        trade_reg_no = NULL, social_security_no = NULL, status = 'I', deleted_at = coalesce(deleted_at, now()) WHERE id IN (${cs})`.execute(tx));
    await sql`UPDATE sys_tenant SET name = code, contact_email = NULL, contact_phone = NULL, status = 'I', purged_at = now() WHERE id = ${tenantId}`.execute(tx);
    return { companies: companies.length, users: users.length, rows: n };
  });
}
