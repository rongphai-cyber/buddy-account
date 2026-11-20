import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { CASH_KINDS, computeDoc, d, EXPENSE_IMPORT_COLUMNS, formatDate, IMPORT_COLUMNS, mapExpenseImport, mapImport, parseCsv, TRADE_KINDS, wht50FormOf, WHT_INCOME_TYPES, whtRateOf, xlsxSharedStrings, xlsxSheetRows,
  type CashKind, type ImportIssue, type TradeKind, type YearSystem, ZERO } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { createZip, readZip } from '../zip.js';
import { allowedFor } from './permissions.js';
import { saveTrade, tradeBody } from './docs/trade.js';
import { cashBody, saveCash } from './docs/cashdocs.js';
import { createMasters, masterRightIssues, planItems, planParties, type PartyHit, type PlannedItem, type PlannedParty } from './import-masters.js';

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * 1) ตรวจ (commit=false): อ่านแฟ้ม หารหัส แล้วลองบันทึกทุกเอกสารใน SAVEPOINT แล้วถอยกลับ — เห็นยอดและข้อผิดพลาดก่อนบันทึกจริง
 * 2) บันทึก (commit=true): บันทึกทุกเอกสารด้วย saveTrade เดียวกับหน้าจอ (ลงบัญชี ภาษี สต๊อก) ในทรานแซกชันเดียว — ผิดฉบับเดียวไม่บันทึกเลย
 * เลขที่อ้างอิงในแฟ้มเก็บใน your_ref — เอกสารที่ยังไม่ยกเลิกของคู่ค้าเดิมที่อ้างอิงเดียวกัน = นำเข้าซ้ำ
 * HANDOFF 167: บันทึกค่าใช้จ่ายอื่น ๆ (OE → saveCash เดียวกับหน้าจอ) · ลูกค้า/ผู้จำหน่าย/สินค้าที่ยังไม่มี เพิ่มให้ในทรานแซกชันเดียวกัน (import-masters.ts)
 */
export const IMPORT_KINDS = TRADE_KINDS.filter((k) => !k.order);
const OE = CASH_KINDS.find((k) => k.cls === 'OE')!;
type Ctx = AuthContext & { companyId: string };
type Kind = { cash: false; K: TradeKind } | { cash: true; K: CashKind };
const kindOf = (path: string): Kind => {
  if (path === OE.path) return { cash: true, K: OE };
  const K = IMPORT_KINDS.find((k) => k.path === path); if (!K) throw notFound('ชนิดเอกสาร'); return { cash: false, K };
};
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
type TplCol = { key: string; th: string; required?: boolean; alt?: string; forNew?: boolean; hint: string; example: [string, string] };
export function buildTemplate(K: { label: string; party: 'customer' | 'supplier'; refInvoice?: boolean }, sample: { party: string | null; partyName?: string | null; items: string[]; date: string }, columns?: TplCol[]): Buffer {
  const who = K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const partyTh = `รหัส${who}`;
  const cols: TplCol[] = columns ?? IMPORT_COLUMNS.filter((c) => c.key !== 'ref_invoice' || K.refInvoice);
  const thOf = (c: TplCol) => (c.key === 'party' ? partyTh : c.key === 'party_name' ? `ชื่อ${who}` : c.th);
  const head = cols.map(thOf);
  const ex = (row: 0 | 1) => cols.map((c) => c.key === 'party' ? sample.party ?? c.example[row] : c.key === 'party_name' ? (sample.party ? sample.partyName ?? '' : c.example[row])
    : c.key === 'item' || c.key === 'code' ? sample.items[row] ?? sample.items[0] ?? c.example[row] : c.key === 'date' ? sample.date : c.example[row]);
  const textCols = new Set(['ref', 'date', 'party', 'item', 'code', 'unit', 'warehouse', 'ref_invoice', 'party_tax_id', 'party_branch', 'party_phone', 'wht_form']);
  const num = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
  const row = (r: number, vals: string[], style: number | null) => `<row r="${r}">${vals.map((v, i) => {
    const ref = `${colName(i)}${r}`, s = style ?? (textCols.has(cols[i]!.key) ? 2 : 0);
    if (v === '') return `<c r="${ref}" s="${s}"/>`;
    return style === null && num(v) && !textCols.has(cols[i]!.key) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr" s="${s}"><is><t>${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`;
  // หัวคอลัมน์ข้อมูลหลักใหม่ใช้สีต่างจากคอลัมน์หลัก (เว้นว่างได้ถ้ามีรหัสในโปรแกรมแล้ว)
  const headRow = `<row r="1">${head.map((v, i) => `<c r="${colName(i)}1" t="inlineStr" s="${cols[i]!.forNew ? 3 : 1}"><is><t>${xmlEsc(v)}</t></is></c>`).join('')}</row>`;
  const colsXml = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${['description', 'remark', 'party_name', 'item_name', 'party_address'].includes(c.key) ? 28 : 15}" customWidth="1"${textCols.has(c.key) ? ' style="2"' : ''}/>`).join('')}</cols>`;
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${headRow}${row(2, ex(0), null)}${row(3, ex(1), null)}</sheetData></worksheet>`;
  const need = (c: TplCol) => (c.required ? (c.alt ? 'รหัสหรือชื่อ' : 'ต้องมี') : c.forNew ? 'รายใหม่' : '');
  const line = K.party === 'customer' || !columns ? 'สินค้าหนึ่งบรรทัด' : 'รหัสค่าใช้จ่ายหนึ่งบรรทัด';
  const help = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [thOf(c), need(c), c.hint]),
    ['', '', ''], ['', '', `หนึ่งแถว = ${line} · แถวที่เลขที่อ้างอิงเดียวกันรวมเป็น${K.label}ฉบับเดียว (วันที่และ${who}ต้องเหมือนกัน)`],
    ['', '', `${who}/สินค้าที่ยังไม่มีในโปรแกรม: ติ๊ก "เพิ่มข้อมูลหลักที่ยังไม่มีให้อัตโนมัติ" ตอนนำเข้า — ระบบเพิ่มให้พร้อมกับเอกสาร (หัวคอลัมน์สีเหลือง "รายใหม่" ใช้ตอนเพิ่ม)`],
    ['', '', `หา${who}เดิม: รหัส → ไม่มีรหัส = เลขผู้เสียภาษี + สาขา → ไม่มีเลข = ชื่อตรงกันทุกตัวอักษร · ไม่พบ = เพิ่มใหม่ (ไม่ใส่รหัส = ออกรหัสต่อจากรหัสล่าสุดให้)`],
    ...(columns ? [['', '', 'รหัสค่าใช้จ่ายต้องมีในโปรแกรมแล้ว (ระบบไม่เพิ่มให้ เพราะต้องกำหนดบัญชีค่าใช้จ่าย) · ชื่อผู้จำหน่ายอย่างเดียว (ไม่มีรหัส/เลขผู้เสียภาษี) ที่ไม่มีในทะเบียน = ใส่ชื่อในเอกสาร ไม่เพิ่มผู้จำหน่าย']]
      : [['', '', 'หาสินค้าเดิม: รหัสหรือบาร์โค้ด → ไม่มีรหัส = ชื่อสินค้าตรงกันทุกตัวอักษร · สินค้าใหม่: หน่วย = หน่วยย่อย (ไม่มีหน่วยนี้ = เพิ่มให้ · ว่าง = หน่วยที่ใช้มากที่สุด) · กลุ่มบัญชี = กลุ่มที่สินค้าใช้มากที่สุด']]),
    ['', '', 'ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้ ลบคอลัมน์ที่ไม่ใช้ได้) · บันทึกเป็น .xlsx หรือ .csv']];
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/><col min="3" max="3" width="110" customWidth="1"/></cols><sheetData>${help.map((h, i) => `<row r="${i + 1}">${h.map((v, j) => v === '' ? '' : `<c r="${colName(j)}${i + 1}" t="inlineStr"${i === 0 ? ' s="1"' : ''}><is><t>${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECE7FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4C2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
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
  /** เพิ่มลูกค้า/ผู้จำหน่าย/สินค้าที่ยังไม่มีให้อัตโนมัติ (HANDOFF 167 · หน้าจอติ๊กไว้เป็นค่าเริ่มต้น) — ไม่ส่ง = ไม่เพิ่ม (กุญแจ API/หน้าจอเดิม) */
  create_masters: z.boolean().default(false),
});
type Result = { ref: string; row: number; date: string; party_code: string; party_name: string | null; party_new: boolean; lines: number; new_items: number; amount: string | null; vat_amount: string | null; wht_amount: string | null; net_amount: string | null; doc_no: string | null; warnings: string[] };

export function tradeImportRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/trade-import/:path/template', async (req, reply) => {
    const a = requireCompany(req);
    const k = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const party = await db.selectFrom(k.K.party === 'customer' ? 'md_customer' : 'md_supplier').select(['code', 'name']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').executeTakeFirst();
    const items = await db.selectFrom('md_item').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A')
      .where('item_type', 'in', k.cash ? ['5'] : ['0', '3']).orderBy('item_type').orderBy('code').limit(2).execute();
    const today = new Date().toISOString().slice(0, 10);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="import-${k.K.cls}.xlsx"`);
    return buildTemplate(k.K, { party: party?.code ?? null, partyName: party?.name ?? null, items: items.map((x) => x.code), date: formatDate(today, co.year_system as YearSystem) }, k.cash ? EXPENSE_IMPORT_COLUMNS : undefined);
  });

  app.post('/api/v1/trade-import/:path', async (req) => {
    const a = requireCompany(req);
    const k = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const K = k.K;
    const b = parse(importBody, req.body);
    if (!(await allowedFor(db, a, K.menu, 'add')).allowed) throw forbidden(`ไม่มีสิทธิ์เพิ่ม${K.label} — นำเข้าไม่ได้`);
    const dt = await db.selectFrom('md_doc_type').select(['id', 'code', 'doc_class', 'status', 'price_type', 'vat_rate']).where('id', '=', b.doc_type_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!dt || dt.doc_class !== K.cls || dt.status !== 'A') throw badRequest(`เลือกประเภทเอกสารของ${K.label}ที่ยังใช้งาน`);
    const s = await companySettings(db, a.companyId);
    const priceType = b.price_type ?? ((dt.price_type || null) as '0' | '1' | '2' | null) ?? (String(s['gen.price_type'] ?? '2') as '0' | '1' | '2');
    const vatRate = String(b.vat_rate ?? dt.vat_rate ?? s['gen.vat_rate'] ?? 7);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const rows = readTable(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const ys = co.year_system as YearSystem;
    const run = k.cash ? importExpense(db, a, k.K, rows, ys, { ...b, priceType, vatRate, dtId: dt.id }) : importTrade(db, a, k.K, rows, ys, { ...b, priceType, vatRate, dtId: dt.id });
    const { results, issues, fileDocs, masters, ran } = await run;
    issues.sort((p, q) => p.row - q.row);
    // ตรวจแฟ้มไม่ผ่าน (ยังไม่ได้ลองบันทึก) = บอกจำนวนให้กดตรวจ · ลองบันทึกแล้วผิด = บอกข้อแรก
    if (b.commit && issues.length) throw badRequest(ran ? `นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})` : `นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้ม" ดูรายละเอียดแล้วแก้ในแฟ้ม`,
      issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
    if (b.commit) await logActivity(db, a, { module: K.module, action: 'IMPORT', docNo: results[0]?.doc_no ?? null, detail: { file: b.file_name, docs: results.length, first: results[0]?.doc_no, last: results.at(-1)?.doc_no,
      new_parties: masters.parties.map((p) => p.code), new_items: masters.items.map((i) => i.code), new_units: masters.units } });
    return { ok: !issues.length, committed: b.commit, price_type: priceType, vat_rate: vatRate, create_masters: b.create_masters, docs: results, errors: issues, file_docs: fileDocs, new_masters: masters,
      total_net: results.reduce((t, r) => t.plus(d(r.net_amount ?? 0)), ZERO).toFixed(2) };
  });
}

type Opt = z.infer<typeof importBody> & { priceType: '0' | '1' | '2'; vatRate: string; dtId: string };
type Masters = { parties: Array<{ code: string; name: string; tax_id: string | null; tax_branch_no: string; row: number }>; items: Array<{ code: string; name: string; kind: '0' | '3'; unit: string | null; row: number }>; units: string[] };
const mastersOf = (pp: PlannedParty[], ip: PlannedItem[], units: string[]): Masters => ({
  parties: pp.map((p) => ({ code: p.code, name: p.name, tax_id: p.tax_id, tax_branch_no: p.tax_branch_no, row: p.row })),
  items: ip.map((i) => ({ code: i.code, name: i.name, kind: i.kind, unit: i.unit, row: i.row })), units,
});

/**
 * ลองบันทึกทุกเอกสาร: ข้อมูลหลักใหม่ + ทีละเอกสารใน SAVEPOINT — ตรวจ: ถอยทั้งหมด (รวมข้อมูลหลักใหม่) · บันทึก: เก็บไว้ (ผิดฉบับใด ทั้งแฟ้มถอยกลับเพราะโยนข้อผิดพลาด)
 * create() เพิ่มข้อมูลหลัก · save(x) บันทึกเอกสารหนึ่งฉบับ → ผลแถว
 */
async function tryAll<T extends { doc: { ref: string; row: number } }>(db: Db, commit: boolean, issues: ImportIssue[], create: () => Promise<string[]>, bodies: () => T[], save: (x: T) => Promise<Result>) {
  const results: Result[] = [];
  if (commit && issues.length) return { results, units: [] as string[], ran: false };
  await sql`SAVEPOINT trade_import_all`.execute(db);
  let units: string[] = [];
  try { units = await create(); } catch (e) {
    await sql`ROLLBACK TO SAVEPOINT trade_import_all`.execute(db);
    if (!(e instanceof AppError)) throw e;
    issues.push({ row: 1, message: `เพิ่มข้อมูลหลักไม่ได้: ${e.message}` });
    return { results, units, ran: true };
  }
  for (const x of bodies()) {
    await sql`SAVEPOINT trade_import`.execute(db);
    try {
      results.push(await save(x));
      await sql`RELEASE SAVEPOINT trade_import`.execute(db);
    } catch (e) {
      await sql`ROLLBACK TO SAVEPOINT trade_import`.execute(db);
      if (!(e instanceof AppError)) throw e;
      issues.push({ row: x.doc.row, message: `เลขที่อ้างอิง ${x.doc.ref}: ${e.message}` });
    }
  }
  await sql.raw(commit && !issues.length ? 'RELEASE SAVEPOINT trade_import_all' : 'ROLLBACK TO SAVEPOINT trade_import_all').execute(db);
  if (!commit) for (const r of results) r.doc_no = null;
  return { results, units, ran: true };
}

/** ขาย/ซื้อ (IV HS DR CN RR HP CP DN): บรรทัดสินค้า → saveTrade เดียวกับหน้าจอ */
async function importTrade(db: Db, a: Ctx, K: TradeKind, rows: string[][], ys: YearSystem, b: Opt) {
  const { docs, errors } = mapImport(rows, ys);
  const issues: ImportIssue[] = [...errors];
  const pp = await planParties(db, a.companyId, K.party, docs, { create: b.create_masters });
  const allLines = docs.flatMap((x) => x.lines);
  const ip = await planItems(db, a.companyId, allLines, { create: b.create_masters });
  const lineHit = new Map(allLines.map((l, i) => [l, ip.hits[i]!]));
  // ข้อมูลหลักที่จะเพิ่มจริง = ที่เอกสารผ่านการหาอ้างถึง
  const usedP = new Set<PlannedParty>(), usedI = new Set<PlannedItem>();
  issues.push(...await masterRightIssues(db, a, K.party, pp.planned, ip.planned));

  const up = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const unitCodes = up(allLines.map((l) => l.unit));
  const loadUnits = async () => new Map((unitCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_unit WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${unitCodes}::text[])`.execute(db)).rows : []).map((u) => [u.code.toUpperCase(), u.id]));
  let unitBy = await loadUnits();
  /** หน่วยในแฟ้ม → หน่วย/ตัวคูณของบรรทัด (หน่วยย่อย · หน่วยขาย · หน่วยซื้อ) · ไม่ใช่หน่วยของสินค้า = null */
  const unitOf = (it: { base_unit_id: string | null; sales_unit_id: string | null; sales_factor: string | null; purchase_unit_id: string | null; purchase_factor: string | null }, unit: string | null) => {
    if (!unit) return { unitId: it.base_unit_id, factor: '1' };
    const u = unitBy.get(unit.toUpperCase());
    if (u && u === it.base_unit_id) return { unitId: u, factor: '1' };
    if (u && u === (K.module === 'AR' ? it.sales_unit_id : it.purchase_unit_id)) return { unitId: u, factor: (K.module === 'AR' ? it.sales_factor : it.purchase_factor) ?? '1' };
    if (u && u === (K.module === 'AR' ? it.purchase_unit_id : it.sales_unit_id)) return { unitId: u, factor: (K.module === 'AR' ? it.purchase_factor : it.sales_factor) ?? '1' };
    return null;
  };
  const whCodes = up(allLines.map((l) => l.warehouse));
  const whs = whCodes.length ? (await sql<{ id: string; code: string }>`SELECT id, code FROM md_warehouse WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${whCodes}::text[])`.execute(db)).rows : [];
  const whBy = new Map(whs.map((w) => [w.code.toUpperCase(), w.id]));
  const refs = docs.map((x) => x.ref);
  const prior = refs.length ? (await sql<{ your_ref: string; party: string; doc_no: string }>`SELECT your_ref, coalesce(customer_id, supplier_id) AS party, doc_no FROM doc_header
      WHERE company_id = ${a.companyId} AND doc_class = ${K.cls} AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : [];

  type Ready = { doc: (typeof docs)[number]; party: PartyHit & { kind: 'found' | 'new' } };
  const ready: Ready[] = [];
  docs.forEach((doc, di) => {
    const n0 = issues.length;
    const h = pp.hits[di]!;
    if (h.kind === 'error') issues.push({ row: doc.row, message: h.message });
    else if (h.kind === 'found') {
      const dup = prior.find((x) => x.your_ref === doc.ref && x.party === h.party.id);
      if (dup) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref} เคยนำเข้าแล้วเป็น ${dup.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${dup.doc_no} ก่อน` });
    }
    if (K.refInvoice && !doc.ref_invoice) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref}: ${K.label}ต้องมี "อ้างใบกำกับ" (เลขที่ใบกำกับเดิม)` });
    for (const l of doc.lines) {
      const ih = lineHit.get(l)!;
      if (ih.kind === 'error') issues.push({ row: l.row, message: ih.message });
      if (ih.kind === 'found' && l.unit && !unitOf(ih.item, l.unit)) issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้า ${ih.item.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้า (หรือเว้นว่าง)` });
      if (ih.kind === 'new' && l.unit && ih.plan.unit && l.unit.toUpperCase() !== ih.plan.unit.toUpperCase()) issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้าใหม่ ${ih.plan.code} (หน่วยย่อย ${ih.plan.unit} ตามแถว ${ih.plan.row})` });
      if (l.warehouse && !whBy.has(l.warehouse.toUpperCase())) issues.push({ row: l.row, message: `ไม่พบคลัง ${l.warehouse}` });
    }
    if (issues.length > n0 || h.kind === 'error' || h.kind === 'name') return;
    if (h.kind === 'new') usedP.add(h.plan);
    for (const l of doc.lines) { const ih = lineHit.get(l)!; if (ih.kind === 'new') usedI.add(ih.plan); }
    ready.push({ doc, party: h });
  });
  const { results, units, ran } = await tryAll(db, b.commit, issues,
    async () => {
      const r = await createMasters(db, a, K.party, [...usedP], [...usedI], b.file_name);
      unitBy = await loadUnits();   // รวมหน่วยที่เพิ่งเพิ่มให้สินค้าใหม่
      return r.units;
    },
    () => ready.flatMap((x) => {
      const lines = x.doc.lines.map((l) => {
        const ih = lineHit.get(l)!;
        const it = ih.kind === 'found' ? ih.item : ih.kind === 'new' ? { id: ih.plan.id!, code: ih.plan.code, base_unit_id: ih.plan.unit_id ?? null, sales_unit_id: null, sales_factor: null, purchase_unit_id: null, purchase_factor: null } : null;
        if (!it) return null;
        const u = unitOf(it, l.unit);
        if (!u) { issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้า ${it.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้า (หรือเว้นว่าง)` }); return null; }
        return { item_id: it.id, description: l.description, warehouse_id: l.warehouse ? whBy.get(l.warehouse.toUpperCase()) ?? null : null, qty: l.qty, unit_id: u.unitId, factor: u.factor, unit_price: l.price, discount_text: l.discount };
      });
      if (lines.some((l) => !l)) return [];
      const party = x.party.kind === 'found' ? { id: x.party.party.id, code: x.party.party.code, name: x.party.party.name, isNew: false, branch: x.party.branch } : { id: x.party.plan.id!, code: x.party.plan.code, name: x.party.plan.name, isNew: true, branch: null };
      return [{ doc: x.doc, party, newItems: x.doc.lines.filter((l) => lineHit.get(l)!.kind === 'new').length,
        body: { doc_type_id: b.dtId, doc_date: x.doc.date, party_id: party.id, ...(party.branch ? { party_tax_branch_no: party.branch } : {}), your_ref: x.doc.ref, ref_no: x.doc.ref_invoice, credit_days: x.doc.credit_days, price_type: b.priceType, vat_rate: b.vatRate, remark: x.doc.remark, lines } }];
    }),
    async (x) => {
      const r = await saveTrade(db, a, K, null, parse(tradeBody, x.body));
      const h = await db.selectFrom('doc_header').select(['amount_after_discount', 'vat_amount', 'wht_amount', 'net_amount']).where('id', '=', r.id!).executeTakeFirstOrThrow();
      return { ref: x.doc.ref, row: x.doc.row, date: x.doc.date, party_code: x.party.code, party_name: x.party.name, party_new: x.party.isNew, lines: x.doc.lines.length, new_items: x.newItems,
        amount: h.amount_after_discount, vat_amount: h.vat_amount, wht_amount: null, net_amount: h.net_amount, doc_no: r.doc_no, warnings: r.warnings };
    });
  return { results, issues, fileDocs: docs.length, masters: mastersOf(pp.planned, ip.planned, units), ran };
}

/** บันทึกค่าใช้จ่ายอื่น ๆ (OE): รหัสค่าใช้จ่าย + จำนวนเงิน · ภาษีหัก ณ ที่จ่ายต่อเอกสาร → saveCash เดียวกับหน้าจอ */
async function importExpense(db: Db, a: Ctx, K: CashKind, rows: string[][], ys: YearSystem, b: Opt) {
  const { docs, errors } = mapExpenseImport(rows, ys);
  const issues: ImportIssue[] = [...errors];
  const pp = await planParties(db, a.companyId, 'supplier', docs, { create: b.create_masters, nameOnly: true });
  issues.push(...await masterRightIssues(db, a, 'supplier', pp.planned, []));
  const codes = [...new Set(docs.flatMap((x) => x.lines.map((l) => l.code.toUpperCase())))];
  const items = codes.length ? (await sql<{ id: string; code: string; item_type: string; status: string; vat_code: string | null }>`SELECT id, code, item_type, status, vat_code FROM md_item
      WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND upper(code) = ANY(${codes}::text[])`.execute(db)).rows : [];
  const itemBy = new Map(items.map((i) => [i.code.toUpperCase(), i]));
  const supIds = pp.hits.flatMap((h) => (h.kind === 'found' ? [h.party.id] : []));
  const sups = new Map((supIds.length ? (await sql<{ id: string; wht_form: string | null; wht_income_desc: string | null; wht_rate: string | null }>`SELECT id, wht_form, wht_income_desc, wht_rate FROM md_supplier
      WHERE company_id = ${a.companyId} AND id = ANY(${supIds}::uuid[])`.execute(db)).rows : []).map((x) => [x.id, x]));
  const refs = docs.map((x) => x.ref);
  const prior = refs.length ? (await sql<{ your_ref: string; party: string | null; party_name: string | null; doc_no: string }>`SELECT your_ref, supplier_id AS party, party_name, doc_no FROM doc_header
      WHERE company_id = ${a.companyId} AND doc_class = ${K.cls} AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : [];
  const usedP = new Set<PlannedParty>();
  type Ready = { doc: (typeof docs)[number]; party: PartyHit };
  const ready: Ready[] = [];
  docs.forEach((doc, di) => {
    const n0 = issues.length;
    const h = pp.hits[di]!;
    if (h.kind === 'error') issues.push({ row: doc.row, message: h.message });
    const dup = h.kind === 'found' ? prior.find((x) => x.your_ref === doc.ref && x.party === h.party.id) : h.kind === 'name' ? prior.find((x) => x.your_ref === doc.ref && !x.party && (x.party_name ?? '').trim() === h.name.trim()) : undefined;
    if (dup) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref} เคยนำเข้าแล้วเป็น ${dup.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${dup.doc_no} ก่อน` });
    for (const l of doc.lines) {
      const it = itemBy.get(l.code.toUpperCase());
      if (!it) issues.push({ row: l.row, message: `ไม่พบรหัสค่าใช้จ่าย ${l.code} — เพิ่มที่ ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ ก่อน (ระบบไม่เพิ่มให้ เพราะต้องกำหนดบัญชีค่าใช้จ่าย)` });
      else if (!['5', '2'].includes(it.item_type)) issues.push({ row: l.row, message: `${it.code} ไม่ใช่รหัสค่าใช้จ่ายอื่น — ใช้รหัสจาก ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ` });
      else if (it.status === 'I') issues.push({ row: l.row, message: `รหัสค่าใช้จ่าย ${it.code} เลิกใช้แล้ว` });
    }
    if (issues.length > n0 || h.kind === 'error') return;
    if (h.kind === 'new') usedP.add(h.plan);
    ready.push({ doc, party: h });
  });
  const { results, units, ran } = await tryAll(db, b.commit, issues,
    async () => (await createMasters(db, a, 'supplier', [...usedP], [], b.file_name)).units,
    () => ready.flatMap((x) => {
      const p = x.party;
      const party = p.kind === 'found' ? { id: p.party.id, code: p.party.code, name: p.party.name, tax: p.party.tax_id, isNew: false, branch: p.branch }
        : p.kind === 'new' ? { id: p.plan.id!, code: p.plan.code, name: p.plan.name, tax: p.plan.tax_id, isNew: true, branch: null } : { id: null, code: '', name: (p as { name: string }).name, tax: x.doc.party_tax_id, isNew: false, branch: null };
      const lines = x.doc.lines.map((l) => { const it = itemBy.get(l.code.toUpperCase())!; return { item_id: it.id, description: l.description, amount: l.amount, vat_code: it.vat_code }; });
      let wht: unknown[] = [];
      if (x.doc.wht) {
        // ฐาน = ยอดก่อน VAT ของเอกสาร (เหมือนแท็บภาษีหัก ณ ที่จ่ายบนหน้าจอ) · ใส่อัตรา = คำนวณภาษี · ใส่ยอด = คำนวณอัตรา
        const calc = computeDoc({ price_type: b.priceType, vat_rate: b.vatRate, lines: lines.map((l) => ({ qty: 1, unit_price: l.amount, vat_code: l.vat_code })) });
        const base = d(calc.net_amount).minus(d(calc.vat_amount));
        const w = x.doc.wht;
        const amount = w.amount ? d(w.amount) : base.times(d(w.rate!)).div(100).toDecimalPlaces(2);
        const rate = w.rate ?? (() => { const r = whtRateOf(amount, base); return r.rate ?? r.raw; })();
        const sup = party.id ? sups.get(party.id) : undefined;
        const form = w.form ?? (wht50FormOf(sup?.wht_form, party.tax) === '3' ? 'S03' : 'S53');
        const income = w.income ?? sup?.wht_income_desc ?? WHT_INCOME_TYPES.find((t) => t.rate === d(rate || 0).toString())?.text ?? 'ค่าบริการ';
        wht = [{ form_type: form, income_type: income, rate: rate || '0', paid_amount: base.toFixed(2), tax_amount: amount.toFixed(2), condition: '1' }];
      }
      return [{ doc: x.doc, party, body: { doc_type_id: b.dtId, doc_date: x.doc.date, party_id: party.id, party_name: party.id ? null : party.name, ...(party.branch ? { party_tax_branch_no: party.branch } : {}),
        your_ref: x.doc.ref, price_type: b.priceType, vat_rate: b.vatRate, remark: x.doc.remark, lines: lines.map(({ vat_code: _v, ...l }) => l), payments: [], wht } }];
    }),
    async (x) => {
      const r = await saveCash(db, a, K, null, parse(cashBody, x.body), { keyed: true });
      const h = await db.selectFrom('doc_header').select(['amount_after_discount', 'vat_amount', 'wht_amount', 'net_amount']).where('id', '=', r.id!).executeTakeFirstOrThrow();
      return { ref: x.doc.ref, row: x.doc.row, date: x.doc.date, party_code: x.party.code, party_name: x.party.name, party_new: x.party.isNew, lines: x.doc.lines.length, new_items: 0,
        amount: h.amount_after_discount, vat_amount: h.vat_amount, wht_amount: h.wht_amount, net_amount: h.net_amount, doc_no: r.doc_no, warnings: r.warnings };
    });
  return { results, issues, fileDocs: docs.length, masters: mastersOf(pp.planned, [], units), ran };
}
