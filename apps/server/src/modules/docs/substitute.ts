import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { bahtText, d } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings, setSetting } from '../../company-template.js';

/**
 * เอกสารซื้อ/ค่าใช้จ่าย (เจ้าของ 19/11/2569 · HANDOFF 144):
 * - บริษัทไม่จดทะเบียน VAT (ค่าตั้ง gen.vat_registered = false): VAT ในบิลรวมเป็นค่าใช้จ่าย → ประเภทราคา 0 (ไม่มีภาษีซื้อ ไม่เข้ารายงานภาษีซื้อ)
 * - บิลไม่มีชื่อผู้ขาย: ใช้เจ้าหนี้กลาง (ap.central_supplier_id) + ผู้จ่ายเงินเป็นพนักงาน → ใบรับรองแทนใบเสร็จรับเงิน (บ.ก.111)
 *   ไม่ใช่ใบกำกับภาษี: ไม่มีภาษีซื้อ (ยอดทั้งหมดเป็นค่าใช้จ่าย) ไม่หัก ณ ที่จ่าย
 */
type Ctx = AuthContext & { companyId: string; apiKeyId?: string | null };
export async function apTaxRules(db: Db, a: Ctx, module: string, partyId: string | null | undefined, b: { price_type: '0' | '1' | '2'; wht?: unknown[]; payer_employee_id?: string | null }) {
  if (module !== 'AP') return { price_type: b.price_type, receipt_substitute: false, payer_employee_id: null };
  const s = await companySettings(db, a.companyId);
  const vatRegistered = s['gen.vat_registered'] !== false;
  const central = !!partyId && s['ap.central_supplier_id'] === partyId;
  let payer: string | null = null;
  if (central) {
    if (b.wht?.length) throw badRequest('ใบรับรองแทนใบเสร็จรับเงิน (เจ้าหนี้กลาง) ไม่หักภาษี ณ ที่จ่าย — ลบรายการภาษีหัก ณ ที่จ่ายออก', [{ field: 'wht', message: 'ไม่หักภาษี ณ ที่จ่าย' }]);
    payer = b.payer_employee_id ?? null;
    if (!payer && !a.apiKeyId) throw badRequest('บิลไม่มีชื่อผู้ขาย (เจ้าหนี้กลาง): เลือกผู้จ่ายเงิน (พนักงาน) ที่จะลงชื่อในใบรับรองแทนใบเสร็จรับเงิน', [{ field: 'payer_employee_id', message: 'เลือกผู้จ่ายเงิน' }]);
    if (payer && !(await db.selectFrom('pay_employee').select('id').where('id', '=', payer).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()))
      throw badRequest('ไม่พบพนักงานผู้จ่ายเงินนี้ในบริษัท — เลือกใหม่', [{ field: 'payer_employee_id', message: 'ไม่พบพนักงาน' }]);
  }
  return { price_type: (central || !vatRegistered ? '0' : b.price_type) as '0' | '1' | '2', receipt_substitute: central, payer_employee_id: payer };
}

/** ผู้จ่ายเงินของเอกสาร (แสดงบนหน้าจอเอกสาร) */
export async function payerOf(db: Db, companyId: string, id: string | null | undefined) {
  if (!id) return null;
  const e = await db.selectFrom('pay_employee').select(['id', 'code', 'title', 'first_name', 'last_name', 'position']).where('id', '=', id).where('company_id', '=', companyId).executeTakeFirst();
  return e ? { id: e.id, code: e.code, name: [e.title, e.first_name, e.last_name].filter(Boolean).join(' '), position: e.position } : null;
}

const empName = (e: { title: string | null; first_name: string; last_name: string | null }) => [e.title, e.first_name, e.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

export function substituteRoutes(app: FastifyInstance, db: Db) {
  /** เจ้าหนี้กลาง / ผู้ขายไม่ระบุชื่อ: ใช้รหัสที่ตั้งไว้ · ไม่มีหรือถูกลบ = สร้างให้ (รหัส NONAME หรือถัดไป) แล้วจำไว้ในค่าตั้งของบริษัท */
  app.post('/api/v1/ai/central-supplier', async (req) => {
    const a = requireCompany(req);
    const s = await companySettings(db, a.companyId);
    const cur = typeof s['ap.central_supplier_id'] === 'string' ? s['ap.central_supplier_id'] as string : null;
    const have = cur ? await db.selectFrom('md_supplier').select(['id', 'code', 'name', 'tax_id', 'tax_branch_no', 'status']).where('id', '=', cur).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : undefined;
    if (have) return have;
    return db.transaction().execute(async (tx) => {
      const used = new Set((await tx.selectFrom('md_supplier').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('code', 'like', 'NONAME%').execute()).map((r) => r.code));
      let code = 'NONAME', n = 1;
      while (used.has(code)) code = `NONAME${++n}`;
      const row = await tx.insertInto('md_supplier').values({ company_id: a.companyId, code, name: 'ผู้ขายไม่ระบุชื่อ (เจ้าหนี้กลาง)', price_type: '0', status: 'A', remark: 'บิลที่ไม่มีชื่อผู้ขาย — ผู้จ่ายเงิน (พนักงาน) ลงชื่อในใบรับรองแทนใบเสร็จรับเงิน · ไม่มีภาษีซื้อ ไม่หัก ณ ที่จ่าย', created_by: a.userId })
        .returning(['id', 'code', 'name', 'tax_id', 'tax_branch_no', 'status']).executeTakeFirstOrThrow();
      await setSetting(tx, a.companyId, 'ap.central_supplier_id', row.id, a.userId);
      await logActivity(tx, a, { module: 'AP', action: 'ADD', docNo: code, table: 'md_supplier', rowId: row.id, detail: { central: true } });
      return row;
    });
  });

  /** ผู้จ่ายเงิน = พนักงานในทะเบียนพนักงาน (ระบบเงินเดือน) ที่ยังทำงานอยู่ — ค้นด้วยรหัส/ชื่อ (ไม่ส่งเลขบัตรประชาชน/เงินเดือน) */
  app.get('/api/v1/payers', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    let s = db.selectFrom('pay_employee').select(['id', 'code', 'title', 'first_name', 'last_name', 'nickname', 'position']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A');
    if (q.q) { const k = `%${q.q}%`; s = s.where((eb) => eb.or([eb('code', 'ilike', k), eb('first_name', 'ilike', k), eb('last_name', 'ilike', k), eb('nickname', 'ilike', k)])); }
    const rows = await s.orderBy('code').limit(q.limit).execute();
    return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: empName(r), position: r.position })) };
  });

  /** ข้อมูลใบรับรองแทนใบเสร็จรับเงิน (แบบ บ.ก.111): วันที่ รายละเอียด จำนวนเงิน รวม (ตัวอักษร) ผู้จ่ายเงิน/ตำแหน่ง */
  app.get('/api/v1/docs/:id/substitute-receipt', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const h = await db.selectFrom('doc_header').select(['id', 'doc_no', 'doc_date', 'doc_class', 'doc_status', 'receipt_substitute', 'payer_employee_id', 'net_amount', 'ref_no', 'remark', 'party_name'])
      .where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!h) throw notFound('เอกสาร');
    if (!h.receipt_substitute) throw badRequest('เอกสารนี้ไม่ใช่บิลเจ้าหนี้กลาง — พิมพ์ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ใช้เจ้าหนี้กลาง');
    const lines = (await sql<{ description: string | null; net_amount: string }>`SELECT description, net_amount::text AS net_amount FROM doc_line
        WHERE header_id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL ORDER BY line_no`.execute(db)).rows;
    const co = await db.selectFrom('sys_company').select(['name_th', 'tax_id', 'address_th']).where('id', '=', a.companyId).executeTakeFirst();
    const p = h.payer_employee_id ? await db.selectFrom('pay_employee').select(['title', 'first_name', 'last_name', 'position']).where('id', '=', h.payer_employee_id).where('company_id', '=', a.companyId).executeTakeFirst() : undefined;
    const total = lines.reduce((t, l) => t.plus(d(l.net_amount)), d(0));
    return {
      company: { name: co?.name_th ?? '', tax_id: co?.tax_id ?? null, address: co?.address_th ?? null },
      doc_no: h.doc_no, doc_date: h.doc_date, cancelled: h.doc_status === 'C', ref_no: h.ref_no,
      lines: lines.map((l) => ({ date: h.doc_date, description: l.description ?? '', amount: d(l.net_amount).toFixed(2) })),
      total: total.toFixed(2), total_text: bahtText(total), payer: p ? { name: empName(p), position: p.position } : null,
    };
  });
}
