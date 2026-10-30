import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { buildEtaxXml, d, ETAX_INVOICE_TYPES, etaxFileName, etaxPostcode, validateEtax, type EtaxDoc, type EtaxTypeCode } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { createZip } from '../zip.js';

/**
 * ส่งออกใบกำกับภาษีอิเล็กทรอนิกส์ (e-Tax Invoice) เป็นแฟ้ม XML ตาม ETDA ขมธอ. 3-2560 (T7.6) — ยังไม่ลงลายมือชื่อ
 * เอกสารขาย: ขายเชื่อ IV (เลือกชื่อ T02/T04/388) · ขายสด HS (T03) · ลดหนี้ CN (81) · เพิ่มหนี้ DR (80) — เฉพาะที่ไม่ยกเลิก
 */
const CLASSES = ['IV', 'HS', 'CN', 'DR'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const ivType = z.enum(ETAX_INVOICE_TYPES as [EtaxTypeCode, ...EtaxTypeCode[]]).default('T02');
type H = Record<string, string | null> & { id: string; doc_no: string; doc_class: string; doc_date: string; created_at: string };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const joinAddr = (...p: Array<string | null | undefined>) => p.map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
const exVat = (h: Record<string, unknown>) => d(s(h.net_amount) || 0).minus(d(s(h.vat_amount) || 0));

/** ประกอบข้อมูลเอกสารจากฐานข้อมูล → EtaxDoc (ข้อมูลผู้ซื้อตามที่บันทึกในเอกสาร) */
async function loadDocs(db: Db, companyId: string, where: ReturnType<typeof sql>, iv: EtaxTypeCode) {
  const co = await db.selectFrom('sys_company').select(['name_th', 'tax_id', 'address_th', 'phone']).where('id', '=', companyId).executeTakeFirstOrThrow();
  const hs = (await sql<H>`SELECT h.*, h.doc_date::text AS doc_date, h.ref_date::text AS ref_date, h.due_date::text AS due_date, to_char(h.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS created_at,
        b.tax_branch_no AS seller_branch, c.code AS cus_code, c.address_1, c.address_2, c.address_3, c.zip_code, c.email, c.phone AS cus_phone, c.tax_branch_no AS cus_branch
      FROM doc_header h LEFT JOIN sys_branch b ON b.id = h.branch_id LEFT JOIN md_customer c ON c.id = coalesce(h.bill_to_customer_id, h.customer_id)
     WHERE h.company_id = ${companyId} AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND h.doc_class IN (${sql.join([...CLASSES])}) AND ${where}
     ORDER BY h.doc_date, h.doc_no LIMIT 5000`.execute(db)).rows;
  if (!hs.length) return [];
  const ids = hs.map((h) => h.id);
  const lines = (await sql<{ header_id: string; item_code: string | null; account_no: string | null; description: string | null; qty: string | null; unit_code: string | null; unit_price: string | null; net_amount: string; stock_effect: number | null; item_type: string | null }>`
      SELECT l.header_id, it.code AS item_code, g.account_no, l.description, l.qty, u.code AS unit_code, l.unit_price, l.net_amount, l.stock_effect, it.item_type
        FROM doc_line l LEFT JOIN md_item it ON it.id = l.item_id LEFT JOIN gl_account g ON g.id = l.account_id LEFT JOIN md_unit u ON u.id = l.unit_id
       WHERE l.header_id = ANY(${ids}::uuid[]) AND l.deleted_at IS NULL AND l.line_kind <> 'K' ORDER BY l.header_id, l.line_no`.execute(db)).rows;
  const notes = (await sql<{ header_id: string; text: string }>`SELECT header_id, text FROM doc_note WHERE header_id = ANY(${ids}::uuid[]) AND line_id IS NULL AND deleted_at IS NULL ORDER BY header_id, seq`.execute(db)).rows;
  // ใบกำกับเดิมของใบเพิ่ม/ลดหนี้ (อ้างด้วยเลขที่ + ลูกค้าเดียวกัน)
  const refNos = [...new Set(hs.filter((h) => (h.doc_class === 'CN' || h.doc_class === 'DR') && h.ref_no).map((h) => h.ref_no!))];
  const refs = refNos.length ? (await sql<{ doc_no: string; doc_class: string; doc_date: string; customer_id: string; net_amount: string; vat_amount: string }>`SELECT doc_no, doc_class, doc_date::text AS doc_date, customer_id, net_amount, vat_amount FROM doc_header
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND doc_status <> 'C' AND doc_class IN ('IV', 'HS') AND doc_no = ANY(${refNos}::text[])`.execute(db)).rows : [];
  const seller = { name: co.name_th, taxId: co.tax_id, address: co.address_th, postcode: etaxPostcode(co.address_th), phone: co.phone };

  return hs.map((h) => {
    const cls = h.doc_class;
    const typeCode: EtaxTypeCode = cls === 'IV' ? iv : cls === 'HS' ? 'T03' : cls === 'CN' ? '81' : '80';
    const pt = s(h.price_type) || '2', rate = d(s(h.vat_rate) || 0);
    const incl = pt === '1' && !rate.isZero();
    const ls = lines.filter((l) => l.header_id === h.id);
    const vatAmt = d(s(h.vat_amount) || 0), taxable = d(s(h.taxable_amount) || 0), deposit = d(s(h.deposit_amount) || 0);
    const vatBasis = pt === '0' ? d(0) : incl ? taxable.minus(vatAmt) : taxable;
    const address = s(h.party_address) || joinAddr(h.address_1, h.address_2, h.address_3, h.zip_code);
    const doc: EtaxDoc = {
      typeCode, id: h.doc_no, issueDate: h.doc_date, createdAt: h.created_at, seller: { ...seller, branchNo: s(h.seller_branch) || '00000' },
      buyer: { name: s(h.party_name), code: h.cus_code, taxId: h.party_tax_id, branchNo: h.party_tax_branch_no || (h.party_tax_id ? h.cus_branch : null), address, postcode: etaxPostcode(address) ?? h.zip_code, email: h.email, phone: h.cus_phone },
      lines: ls.map((l) => ({ code: l.item_code ?? l.account_no, name: s(l.description), qty: l.qty ?? '1', unitCode: l.unit_code,
        unitPrice: incl ? d(l.unit_price ?? 0).times(100).div(rate.plus(100)).toDecimalPlaces(4) : (l.unit_price ?? '0'), net: l.net_amount })),
      vat: pt === '0' ? null : { rate: rate.toString(), basis: vatBasis.toFixed(2), amount: vatAmt.toFixed(2) },
      // ไม่มี VAT: ทั้งฉบับเป็นฐานยกเว้น (ข้อมูลย้ายจาก Express ไม่ได้เก็บแยก)
      exemptBasis: pt === '0' ? (s(h.net_amount) || '0') : d(s(h.zero_rate_amount) || '0').plus(d(s(h.exempt_amount) || '0')).toFixed(2),
      deposit: (incl ? deposit.times(100).div(rate.plus(100)).toDecimalPlaces(2) : deposit).toFixed(2),
      grandTotal: s(h.net_amount) || '0',
      dueDate: cls === 'IV' ? h.due_date : null, buyerOrderRef: h.your_ref,
      notes: notes.filter((n) => n.header_id === h.id).map((n) => n.text),
    };
    if (cls === 'CN' || cls === 'DR') {
      const ref = refs.find((r) => r.doc_no === h.ref_no && r.customer_id === h.customer_id) ?? refs.find((r) => r.doc_no === h.ref_no);
      const service = ls.length > 0 && ls.every((l) => l.item_type === '5' || !l.item_code);
      const returned = cls === 'CN' && ls.some((l) => (l.stock_effect ?? 0) > 0);
      doc.purposeCode = cls === 'CN' ? (returned ? 'CDNG05' : service ? 'CDNS99' : 'CDNG99') : service ? 'DBNS99' : 'DBNG99';
      doc.purpose = s(h.remark) || null;
      doc.deposit = '0';
      if (h.ref_no) doc.ref = { id: h.ref_no, date: s(h.ref_date) || ref?.doc_date || '', typeCode: ref?.doc_class === 'HS' ? 'T03' : iv };
      if (ref) {
        const orig = exVat(ref), diff = exVat(h);
        doc.originalAmount = orig.toFixed(2);
        doc.correctAmount = (cls === 'CN' ? orig.minus(diff) : orig.plus(diff)).toFixed(2);
      }
    }
    return { h, doc, errors: validateEtax(doc) };
  });
}

export function etaxRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/etax/docs', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ from: isoDate, to: isoDate, iv_type: ivType }), req.query);
    const rows = await loadDocs(db, a.companyId, sql`h.doc_date BETWEEN ${q.from} AND ${q.to}`, q.iv_type);
    return {
      rows: rows.map(({ h, doc, errors }) => ({ id: h.id, doc_no: h.doc_no, doc_date: h.doc_date, doc_class: h.doc_class, type_code: doc.typeCode, party_name: h.party_name, net_amount: h.net_amount, purpose_code: doc.purposeCode ?? null, errors })),
    };
  });

  /** แฟ้มเดียว */
  app.get('/api/v1/etax/doc/:id', async (req, reply) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const q = parse(z.object({ iv_type: ivType }), req.query);
    const [r] = await loadDocs(db, a.companyId, sql`h.id = ${id}`, q.iv_type);
    if (!r) throw notFound('เอกสารขาย (ขายเชื่อ ขายสด ลดหนี้ เพิ่มหนี้ ที่ไม่ยกเลิก)');
    if (r.errors.length) throw badRequest(`สร้างแฟ้ม e-Tax ของ ${r.h.doc_no} ไม่ได้: ${r.errors.join(' · ')}`, r.errors.map((m) => ({ field: 'doc', message: m })));
    await logActivity(db, a, { module: 'FI.VAT.ETAX', action: 'ETAX_EXPORT', docNo: r.h.doc_no, table: 'doc_header', rowId: r.h.id, detail: { type: r.doc.typeCode } });
    reply.header('content-type', 'application/xml; charset=utf-8').header('content-disposition', `attachment; filename="${etaxFileName(r.doc)}"`);
    return buildEtaxXml(r.doc);
  });

  /** หลายฉบับตามช่วงวันที่ → zip (เฉพาะฉบับที่ผ่านการตรวจ + รายการที่ข้าม) */
  app.get('/api/v1/etax/export', async (req, reply) => {
    const a = requireCompany(req);
    const q = parse(z.object({ from: isoDate, to: isoDate, iv_type: ivType, ids: z.string().optional() }), req.query);
    const only = q.ids?.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const rows = (await loadDocs(db, a.companyId, sql`h.doc_date BETWEEN ${q.from} AND ${q.to}`, q.iv_type)).filter((r) => !only?.length || only.includes(r.h.id));
    const ok = rows.filter((r) => !r.errors.length), bad = rows.filter((r) => r.errors.length);
    if (!ok.length) throw badRequest(rows.length ? `ทุกฉบับในช่วงนี้ยังสร้างแฟ้มไม่ได้ (${bad.length} ฉบับ) — แก้ตามข้อความในรายการก่อน` : 'ไม่มีเอกสารขายในช่วงวันที่นี้');
    const files = ok.map((r) => ({ name: etaxFileName(r.doc), data: buildEtaxXml(r.doc) }));
    const summary = ['เลขที่,วันที่,ชนิด,ผู้ซื้อ,ยอดรวม,ผล', ...rows.map((r) => [r.h.doc_no, r.h.doc_date, r.doc.typeCode, `"${s(r.h.party_name).replace(/"/g, '""')}"`, s(r.h.net_amount), r.errors.length ? `"ข้าม: ${r.errors.join(' · ').replace(/"/g, '""')}"` : 'สร้างแฟ้มแล้ว'].join(','))];
    files.push({ name: 'สรุป.csv', data: '﻿' + summary.join('\r\n') + '\r\n' });
    await logActivity(db, a, { module: 'FI.VAT.ETAX', action: 'ETAX_EXPORT', detail: { from: q.from, to: q.to, files: ok.length, skipped: bad.length } });
    reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="etax-${q.from.replaceAll('-', '')}-${q.to.replaceAll('-', '')}.zip"`);
    return createZip(files);
  });
}
