import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, formatDate, IMPORT_COLUMNS, mapImport, parseCsv, TRADE_KINDS, xlsxSharedStrings, xlsxSheetRows, type ImportIssue, type TradeKind, type YearSystem, ZERO } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { createZip, readZip } from '../zip.js';
import { allowedFor } from './permissions.js';
import { saveTrade, tradeBody } from './docs/trade.js';

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * 1) ตรวจ (commit=false): อ่านแฟ้ม หารหัส แล้วลองบันทึกทุกเอกสารใน SAVEPOINT แล้วถอยกลับ — เห็นยอดและข้อผิดพลาดก่อนบันทึกจริง
 * 2) บันทึก (commit=true): บันทึกทุกเอกสารด้วย saveTrade เดียวกับหน้าจอ (ลงบัญชี ภาษี สต๊อก) ในทรานแซกชันเดียว — ผิดฉบับเดียวไม่บันทึกเลย
 * เลขที่อ้างอิงในแฟ้มเก็บใน your_ref — เอกสารที่ยังไม่ยกเลิกของคู่ค้าเดิมที่อ้างอิงเดียวกัน = นำเข้าซ้ำ
 */
export const IMPORT_KINDS = TRADE_KINDS.filter((k) => !k.order);
const kindOf = (path: string) => { const K = IMPORT_KINDS.find((k) => k.path === path); if (!K) throw notFound('ชนิดเอกสาร'); return K; };
const MAX_FILE = 10 * 1024 * 1024;

/** แฟ้มที่ผู้ใช้ส่งมา → ตาราง (xlsx แผ่นงานแรก หรือ CSV UTF-8 / TIS-620) */
export function readTable(fileName: string, buf: Buffer): string[][] {
  if (buf.length > MAX_FILE) throw badRequest('แฟ้มใหญ่เกิน 10 MB — แบ่งเป็นหลายแฟ้ม');
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw badRequest('แฟ้ม .xls แบบเก่าอ่านไม่ได้ — ใน Excel เลือก บันทึกเป็น › "สมุดงาน Excel (.xlsx)" หรือ CSV แล้วเลือกแฟ้มใหม่');
  if (buf.subarray(0, 2).toString('latin1') === 'PK') {
    let z: Map<string, Buffer>;
    try { z = readZip(buf); } catch { throw badRequest('เปิดแฟ้ม .xlsx ไม่ได้ (แฟ้มเสียหาย) — บันทึกใหม่จาก Excel'); }
    const txt = (n: string) => z.get(n)?.toString('utf8');
    const wb = txt('xl/workbook.xml');
    if (!wb) throw badRequest('ไม่ใช่แฟ้ม Excel (.xlsx)');
    // แผ่นงานแรกตามลำดับในสมุดงาน → แฟ้มตาม relationship
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    const rels = txt('xl/_rels/workbook.xml.rels') ?? '';
    const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
    const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
    const sheet = txt(path);
    if (!sheet) throw badRequest('ไม่พบแผ่นงานในแฟ้ม Excel');
    return xlsxSheetRows(sheet, xlsxSharedStrings(txt('xl/sharedStrings.xml') ?? ''));
  }
  if (!/\.(csv|txt)$/i.test(fileName) && buf.includes(0)) throw badRequest('อ่านได้เฉพาะแฟ้ม .xlsx หรือ .csv');
  let text = new TextDecoder('utf-8').decode(buf);
  // CSV จาก Excel ไทยรุ่นเก่าเป็นรหัส TIS-620 (windows-874)
  if (text.includes('�')) text = new TextDecoder('windows-874').decode(buf);
  return parseCsv(text);
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

/** แบบฟอร์มตัวอย่าง .xlsx: แผ่น "นำเข้า" (หัวคอลัมน์ + ตัวอย่าง 2 แถว · ช่องรหัส/วันที่เป็นข้อความ) + แผ่น "คำอธิบาย" */
export function buildTemplate(K: TradeKind, sample: { party: string | null; items: string[]; date: string }): Buffer {
  const partyTh = K.party === 'customer' ? 'รหัสลูกค้า' : 'รหัสผู้จำหน่าย';
  const cols = IMPORT_COLUMNS.filter((c) => c.key !== 'ref_invoice' || K.refInvoice);
  const head = cols.map((c) => (c.key === 'party' ? partyTh : c.th));
  const ex = (row: 0 | 1) => cols.map((c) => c.key === 'party' ? sample.party ?? c.example[row] : c.key === 'item' ? sample.items[row] ?? sample.items[0] ?? c.example[row] : c.key === 'date' ? sample.date : c.example[row]);
  const textCols = new Set(['ref', 'date', 'party', 'item', 'unit', 'warehouse', 'ref_invoice']);
  const num = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
  const row = (r: number, vals: string[], style: number | null) => `<row r="${r}">${vals.map((v, i) => {
    const ref = `${colName(i)}${r}`, s = style ?? (textCols.has(cols[i]!.key) ? 2 : 0);
    if (v === '') return `<c r="${ref}" s="${s}"/>`;
    return style === null && num(v) && !textCols.has(cols[i]!.key) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr" s="${s}"><is><t>${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`;
  const colsXml = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.key === 'description' || c.key === 'remark' ? 28 : 15}" customWidth="1"${textCols.has(c.key) ? ' style="2"' : ''}/>`).join('')}</cols>`;
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${row(1, head, 1)}${row(2, ex(0), null)}${row(3, ex(1), null)}</sheetData></worksheet>`;
  const help = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [c.key === 'party' ? partyTh : c.th, c.required ? 'ต้องมี' : '', c.hint]),
    ['', '', ''], ['', '', `หนึ่งแถว = สินค้าหนึ่งบรรทัด · แถวที่เลขที่อ้างอิงเดียวกันรวมเป็น${K.label}ฉบับเดียว (วันที่และรหัสคู่ค้าต้องเหมือนกัน)`],
    ['', '', 'ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้) · บันทึกเป็น .xlsx หรือ .csv']];
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="9" customWidth="1"/><col min="3" max="3" width="100" customWidth="1"/></cols><sheetData>${help.map((h, i) => `<row r="${i + 1}">${h.map((v, j) => v === '' ? '' : `<c r="${colName(j)}${i + 1}" t="inlineStr"${i === 0 ? ' s="1"' : ''}><is><t>${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECE7FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return createZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns}><sheets><sheet name="นำเข้า" sheetId="1" r:id="rId1"/><sheet name="คำอธิบาย" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
    { name: 'xl/styles.xml', data: styles },
  ]);
}

const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'),
  doc_type_id: z.string({ required_error: 'เลือกประเภทเอกสาร' }).uuid('เลือกประเภทเอกสาร'),
  price_type: z.enum(['0', '1', '2']).optional(), vat_rate: z.union([z.number(), z.string()]).optional(), commit: z.boolean().default(false),
});
type Result = { ref: string; row: number; date: string; party_code: string; party_name: string | null; lines: number; amount: string | null; vat_amount: string | null; net_amount: string | null; doc_no: string | null; warnings: string[] };

export function tradeImportRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/trade-import/:path/template', async (req, reply) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const party = await db.selectFrom(K.party === 'customer' ? 'md_customer' : 'md_supplier').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').executeTakeFirst();
    const items = await db.selectFrom('md_item').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A')
      .where('item_type', 'in', ['0', '3']).orderBy('item_type').orderBy('code').limit(2).execute();
    const today = new Date().toISOString().slice(0, 10);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="import-${K.cls}.xlsx"`);
    return buildTemplate(K, { party: party?.code ?? null, items: items.map((x) => x.code), date: formatDate(today, co.year_system as YearSystem) });
  });

  app.post('/api/v1/trade-import/:path', async (req) => {
    const a = requireCompany(req);
    const K = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, K.menu, 'add'))) throw forbidden(`ไม่มีสิทธิ์เพิ่ม${K.label} — นำเข้าไม่ได้`);
    const dt = await db.selectFrom('md_doc_type').select(['id', 'code', 'doc_class', 'status', 'price_type', 'vat_rate']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!dt || dt.doc_class !== K.cls || dt.status !== 'A') throw badRequest(`เลือกประเภทเอกสารของ${K.label}ที่ยังใช้งาน`);
    const s = await companySettings(db, a.companyId);
    const priceType = b.price_type ?? ((dt.price_type || null) as '0' | '1' | '2' | null) ?? (String(s['gen.price_type'] ?? '2') as '0' | '1' | '2');
    const vatRate = String(b.vat_rate ?? dt.vat_rate ?? s['gen.vat_rate'] ?? 7);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const rows = readTable(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const { docs, errors } = mapImport(rows, co.year_system as YearSystem);
    const issues: ImportIssue[] = [...errors];

    // หารหัสทั้งแฟ้มครั้งเดียว (ไม่สนตัวพิมพ์เล็ก/ใหญ่ · สินค้าหาจากรหัสหรือบาร์โค้ด)
    const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
    const partyTbl = K.party === 'customer' ? 'md_customer' : 'md_supplier';
    const partyCodes = up(docs.map((x) => x.party)), itemCodes = up(docs.flatMap((x) => x.lines.map((l) => l.item)));
    const unitCodes = up(docs.flatMap((x) => x.lines.map((l) => l.unit))), whCodes = up(docs.flatMap((x) => x.lines.map((l) => l.warehouse)));
    const parties = partyCodes.length ? (await sql<{ id: string; code: string; name: string; status: string }>`SELECT id, code, name, status FROM ${sql.table(partyTbl)}
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${partyCodes}::text[])`.execute(db)).rows : [];
    const items = itemCodes.length ? (await sql<{ id: string; code: string; barcode: string | null; base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null }>`
        SELECT id, code, barcode, base_unit_id, sales_unit_id, sales_factor, purchase_unit_id, purchase_factor FROM md_item
         WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND (upper(code) = ANY(${itemCodes}::text[]) OR upper(barcode) = ANY(${itemCodes}::text[]))`.execute(db)).rows : [];
    const units = unitCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_unit WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${unitCodes}::text[])`.execute(db)).rows : [];
    const whs = whCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_warehouse WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${whCodes}::text[])`.execute(db)).rows : [];
    const partyBy = new Map(parties.map((p) => [p.code.toUpperCase(), p]));
    const itemBy = new Map(items.map((i) => [i.code.toUpperCase(), i]));
    for (const i of items) if (i.barcode && !itemBy.has(i.barcode.toUpperCase())) itemBy.set(i.barcode.toUpperCase(), i);
    const unitBy = new Map(units.map((u) => [u.code.toUpperCase(), u.id])), whBy = new Map(whs.map((w) => [w.code.toUpperCase(), w.id]));
    const who = K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
    // นำเข้าซ้ำ: เลขที่อ้างอิงเดียวกันของคู่ค้าเดิม ที่ยังไม่ยกเลิก
    const refs = docs.map((x) => x.ref);
    const prior = refs.length ? (await sql<{ your_ref: string; party: string; doc_no: string }>`SELECT your_ref, coalesce(customer_id, supplier_id) AS party, doc_no FROM doc_header
        WHERE company_id = ${a.companyId} AND doc_class = ${K.cls} AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : [];

    const bodies: Array<{ doc: (typeof docs)[number]; party: (typeof parties)[number]; body: unknown }> = [];
    for (const doc of docs) {
      const n0 = issues.length;
      const p = partyBy.get(doc.party.toUpperCase());
      if (!p) issues.push({ row: doc.row, message: `ไม่พบรหัส${who} ${doc.party} — เพิ่มที่ รายละเอียด${who}ก่อน` });
      else if (p.status === 'I') issues.push({ row: doc.row, message: `${who} ${p.code} เลิกใช้แล้ว` });
      const dup = p && prior.find((x) => x.your_ref === doc.ref && x.party === p.id);
      if (dup) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref} เคยนำเข้าแล้วเป็น ${dup.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${dup.doc_no} ก่อน` });
      if (K.refInvoice && !doc.ref_invoice) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref}: ${K.label}ต้องมี "อ้างใบกำกับ" (เลขที่ใบกำกับเดิม)` });
      const lines = doc.lines.map((l) => {
        const it = itemBy.get(l.item.toUpperCase());
        if (!it) { issues.push({ row: l.row, message: `ไม่พบรหัสสินค้า ${l.item}` }); return null; }
        let unitId = it.base_unit_id, factor = '1';
        if (l.unit) {
          const u = unitBy.get(l.unit.toUpperCase());
          if (u && u === it.base_unit_id) { /* หน่วยย่อย */ }
          else if (u && u === (K.module === 'AR' ? it.sales_unit_id : it.purchase_unit_id)) { unitId = u; factor = (K.module === 'AR' ? it.sales_factor : it.purchase_factor) ?? '1'; }
          else if (u && u === (K.module === 'AR' ? it.purchase_unit_id : it.sales_unit_id)) { unitId = u; factor = (K.module === 'AR' ? it.purchase_factor : it.sales_factor) ?? '1'; }
          else { issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้า ${it.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้า (หรือเว้นว่าง)` }); return null; }
        }
        const wh = l.warehouse ? whBy.get(l.warehouse.toUpperCase()) : null;
        if (l.warehouse && !wh) { issues.push({ row: l.row, message: `ไม่พบคลัง ${l.warehouse}` }); return null; }
        return { item_id: it.id, description: l.description, warehouse_id: wh ?? null, qty: l.qty, unit_id: unitId, factor, unit_price: l.price, discount_text: l.discount };
      });
      if (issues.length > n0 || !p) continue;
      bodies.push({ doc, party: p, body: { doc_type_id: dt.id, doc_date: doc.date, party_id: p.id, your_ref: doc.ref, ref_no: doc.ref_invoice, credit_days: doc.credit_days, price_type: priceType, vat_rate: vatRate, remark: doc.remark, lines } });
    }
    if (b.commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้ม" ดูรายละเอียดแล้วแก้ในแฟ้ม`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));

    // ลองบันทึกทีละเอกสารใน SAVEPOINT — ตรวจ: ถอยทุกฉบับ · บันทึก: เก็บไว้ (ผิดฉบับใดโยนข้อผิดพลาด ทั้งแฟ้มถอยกลับ)
    const results: Result[] = [];
    for (const x of bodies) {
      await sql`SAVEPOINT trade_import`.execute(db);
      try {
        const r = await saveTrade(db, a, K, null, parse(tradeBody, x.body));
        const h = await db.selectFrom('doc_header').select(['amount_after_discount', 'vat_amount', 'net_amount']).where('id', '=', r.id!).executeTakeFirstOrThrow();
        results.push({ ref: x.doc.ref, row: x.doc.row, date: x.doc.date, party_code: x.party.code, party_name: x.party.name, lines: x.doc.lines.length,
          amount: h.amount_after_discount, vat_amount: h.vat_amount, net_amount: h.net_amount, doc_no: b.commit ? r.doc_no : null, warnings: r.warnings });
        await sql.raw(b.commit ? 'RELEASE SAVEPOINT trade_import' : 'ROLLBACK TO SAVEPOINT trade_import').execute(db);
      } catch (e) {
        await sql`ROLLBACK TO SAVEPOINT trade_import`.execute(db);
        if (!(e instanceof AppError)) throw e;
        issues.push({ row: x.doc.row, message: `เลขที่อ้างอิง ${x.doc.ref}: ${e.message}` });
      }
    }
    if (b.commit && issues.length) throw badRequest(`นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})`, issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
    issues.sort((p, q) => p.row - q.row);
    if (b.commit) await logActivity(db, a, { module: K.module, action: 'IMPORT', docNo: results[0]?.doc_no ?? null, detail: { file: b.file_name, docs: results.length, first: results[0]?.doc_no, last: results.at(-1)?.doc_no } });
    return { ok: !issues.length, committed: b.commit, price_type: priceType, vat_rate: vatRate, docs: results, errors: issues, file_docs: docs.length, total_net: results.reduce((t, r) => t.plus(d(r.net_amount ?? 0)), ZERO).toFixed(2) };
  });
}
