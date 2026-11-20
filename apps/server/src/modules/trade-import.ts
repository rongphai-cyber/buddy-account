import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { CASH_KINDS, computeDoc, d, EXPENSE_IMPORT_COLUMNS, formatDate, IMPORT_COLUMNS, importColumnsFor, importHeaderText, importNeedLabel, mapExpenseImport, mapImport, mapPaymentImport, missingCodeRows, parseCsv,
  PAYMENT_IMPORT_COLUMNS, TRADE_KINDS, wht50FormOf, WHT_INCOME_TYPES, whtRateOf, xlsxSharedStrings, xlsxSheetRows,
  type CashKind, type ExpenseImportWht, type ImportIssue, type ImportKindLike, type ImportNeed, type ImportPayment, type TradeKind, type YearSystem, ZERO } from '@buddy/core';
import type { Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { readZip } from '../zip.js';
import { buildXlsx, type XlsxSheet } from '../xlsx.js';
import { allowedFor } from './permissions.js';
import { saveTrade, tradeBody } from './docs/trade.js';
import { cashBody, saveCash } from './docs/cashdocs.js';
import { createMasters, masterRightIssues, planItems, planParties, type PartyHit, type PlannedItem, type PlannedParty } from './import-masters.js';
import { codesBody, mappingBody, transformTable } from './import-map.js';
import { buildPayments, finder, loadRefs, methodsOf, shipTosOf } from './import-fields.js';

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

/** แฟ้มที่ผู้ใช้ส่งมา → แผ่นงานทั้งหมดตามลำดับ (xlsx) หรือแผ่นเดียว (CSV UTF-8 / TIS-620) */
export function readSheets(fileName: string, buf: Buffer): Array<{ name: string; rows: string[][] }> {
  if (buf.length > MAX_FILE) throw badRequest('แฟ้มใหญ่เกิน 10 MB — แบ่งเป็นหลายแฟ้ม');
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw badRequest('แฟ้ม .xls แบบเก่าอ่านไม่ได้ — ใน Excel เลือก บันทึกเป็น › "สมุดงาน Excel (.xlsx)" หรือ CSV แล้วเลือกแฟ้มใหม่');
  if (buf.subarray(0, 2).toString('latin1') === 'PK') {
    let z: Map<string, Buffer>;
    try { z = readZip(buf); } catch { throw badRequest('เปิดแฟ้ม .xlsx ไม่ได้ (แฟ้มเสียหาย) — บันทึกใหม่จาก Excel'); }
    const txt = (n: string) => z.get(n)?.toString('utf8');
    const wb = txt('xl/workbook.xml');
    if (!wb) throw badRequest('ไม่ใช่แฟ้ม Excel (.xlsx)');
    const rels = txt('xl/_rels/workbook.xml.rels') ?? '';
    const shared = xlsxSharedStrings(txt('xl/sharedStrings.xml') ?? '');
    // แผ่นงานตามลำดับในสมุดงาน → แฟ้มตาม relationship
    const out: Array<{ name: string; rows: string[][] }> = [];
    for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = m[1] ?? '';
      const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1];
      const name = (/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
      const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : `xl/worksheets/sheet${out.length + 1}.xml`;
      const sheet = txt(path);
      if (sheet) out.push({ name, rows: xlsxSheetRows(sheet, shared) });
    }
    if (!out.length) throw badRequest('ไม่พบแผ่นงานในแฟ้ม Excel');
    return out;
  }
  if (!/\.(csv|txt)$/i.test(fileName) && buf.includes(0)) throw badRequest('อ่านได้เฉพาะแฟ้ม .xlsx หรือ .csv');
  let text = new TextDecoder('utf-8').decode(buf);
  // CSV จาก Excel ไทยรุ่นเก่าเป็นรหัส TIS-620 (windows-874)
  if (text.includes('�')) text = new TextDecoder('windows-874').decode(buf);
  return [{ name: '', rows: parseCsv(text) }];
}
/** แผ่นงานแรก (แผ่นนำเข้า) */
export function readTable(fileName: string, buf: Buffer): string[][] {
  return readSheets(fileName, buf)[0]?.rows ?? [];
}
/** แผ่น "รับชำระ"/"จ่ายชำระ" (แบ่งหลายวิธีชำระ — HANDOFF 169) */
/** กติกาบนสุดของแผ่นรับ/จ่ายชำระ (เจ้าของงงว่าใส่ที่ไหน — HANDOFF 170) */
export const PAY_SHEET_RULE = 'วิธีเดียว: ใช้คอลัมน์ "วิธีชำระ" ในแผ่นนำเข้า · หลายวิธี (เช่น เงินสด + เงินโอน): ใช้แผ่นนี้ หนึ่งแถว = หนึ่งวิธี และเว้นคอลัมน์ "วิธีชำระ" ในแผ่นนำเข้า · ใส่ทั้งสองที่ = ผิด · ไม่ใส่ทั้งสองที่ = เงินสดทั้งหมด';
const paySheetOf = (sheets: Array<{ name: string; rows: string[][] }>) => sheets.slice(1).find((s) => /รับชำระ|จ่ายชำระ|ชำระ|payment/i.test(s.name))?.rows ?? [];

type TplCol = { key: string; th: string; need: ImportNeed; when?: string; dflt?: string; forNew?: boolean; hint: string; example: [string, string] };
const TEXT_KEYS = new Set(['ref', 'date', 'party', 'item', 'code', 'unit', 'warehouse', 'ref_invoice', 'ref_no', 'ref_date', 'party_tax_id', 'party_branch', 'party_phone', 'wht_form', 'ship_to', 'department', 'project',
  'salesperson', 'sales_area', 'ship_via', 'pay_ref', 'line_job', 'vat_code', 'cheque_date', 'method']);
const NUM_KEYS = new Set(['qty', 'price', 'amount', 'wht_amount', 'wht_rate']);
/**
 * แบบฟอร์มตัวอย่าง .xlsx ตามชนิดเอกสาร (HANDOFF 169 — มีทุกช่องที่หน้าจอเอกสารนั้นมี ไม่มีช่องที่หน้าจอไม่มี):
 * แผ่น "นำเข้า" (หัวสีชมพู * = ต้องมี · สีเหลือง = ต้องมีถ้า… · ตัวอย่าง 2 แถว) · ขาย/ซื้อเงินสด ค่าใช้จ่ายอื่น: แผ่น "รับชำระ"/"จ่ายชำระ" · แผ่น "คำอธิบาย"
 */
export function buildTemplate(K: ImportKindLike & { label: string }, sample: { party: string | null; partyName?: string | null; items: string[]; date: string; prefix?: string | null }, cash = false): Buffer {
  const all: Array<TplCol & { check?: boolean }> = cash ? EXPENSE_IMPORT_COLUMNS : importColumnsFor(K);
  // ช่องตรวจยอด (ภาษี VAT · ราคาสุทธิ) ไม่ใช่ช่องของหน้าจอ — ไม่อยู่ในแผ่นนำเข้า (อธิบายในแผ่นคำอธิบาย)
  const cols = all.filter((c) => !c.check), checks = all.filter((c) => c.check);
  const who = K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const prefix = sample.prefix || K.cls;
  // ตัวอย่าง: แถว 2–3 = บิลเดียวสองบรรทัด (มี VAT + ยกเว้น VAT · เลขที่ออกอัตโนมัติ) · แถว 4 = บิลที่ใส่เลขที่เอกสารเอง
  const ex = (row: 0 | 1 | 2) => cols.map((c) => {
    const r = row === 2 ? 0 : row;
    if (row === 2 && c.key === 'ref') return c.example[0].replace(/1$/, '2');
    if (c.key === 'doc_no') return row === 2 ? `${prefix}-EX-001` : '';
    return c.key === 'party' ? sample.party ?? c.example[r] : c.key === 'party_name' ? (sample.party ? sample.partyName ?? '' : c.example[r])
      : c.key === 'item' || c.key === 'code' ? sample.items[r] ?? sample.items[0] ?? c.example[r] : c.key === 'date' ? sample.date : c.example[r];
  });
  const kinds = (cs: Array<{ need: ImportNeed }>) => Object.fromEntries(cs.map((c, i) => [i, c.need === 'req' ? 'req' : c.need === 'cond' ? 'cond' : null] as const).filter((x) => x[1])) as Record<number, 'req' | 'cond'>;
  const idx = (cs: Array<{ key: string }>, set: Set<string>) => cs.map((c, i) => (set.has(c.key) ? i : -1)).filter((i) => i >= 0);
  const sheets: XlsxSheet[] = [{ name: 'นำเข้า', rows: [cols.map(importHeaderText), ex(0), ex(1), ex(2)], textCols: idx(cols, TEXT_KEYS), numCols: idx(cols, NUM_KEYS), headKinds: kinds(cols),
    widths: cols.map((c) => (['description', 'remark', 'party_name', 'item_name', 'party_address'].includes(c.key) ? 28 : 15)) }];
  const hasPay = cash || !!(K as ImportKindLike).payments;
  const payName = K.module === 'AR' ? 'รับชำระ' : 'จ่ายชำระ';
  const pcols = PAYMENT_IMPORT_COLUMNS.filter((c) => c.key !== 'cheque_date' || cash);
  // กติกาไว้บนสุดของแผ่น (ตัวอ่านหาหัวตารางเองภายใน 20 แถวแรก — แถวกติกาไม่ใช่หัวตาราง)
  if (hasPay) sheets.push({ name: payName, rows: [[PAY_SHEET_RULE], pcols.map(importHeaderText)], headAt: 1, textCols: idx(pcols, TEXT_KEYS), numCols: idx(pcols, NUM_KEYS), headKinds: kinds(pcols), widths: pcols.map(() => 18) });
  const line = cash ? 'รหัสค่าใช้จ่ายหนึ่งบรรทัด' : 'สินค้าหนึ่งบรรทัด';
  const help: string[][] = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...cols.map((c) => [c.th, importNeedLabel(c), c.hint]),
    ['', '', ''],
    ['', '', `หนึ่งแถว = ${line} · แถวที่เลขที่อ้างอิงเดียวกันรวมเป็น${K.label}ฉบับเดียว — ช่องของหัวเอกสาร (วันที่ ${who} แผนก …) ใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม`],
    ['', '', 'หัวคอลัมน์สีชมพู มี * = ต้องมี (หน้าจอบันทึกไม่ได้ถ้าไม่มี) · สีเหลือง = ต้องมีตามเงื่อนไข · สีปกติ = ไม่บังคับ เว้นว่าง = ค่าเริ่มต้นเดียวกับหน้าจอ · ลบคอลัมน์ที่ไม่ใช้ได้'],
    ['', '', 'ช่องรหัส (คลัง แผนก Job พนักงานขาย เขตการขาย ขนส่งโดย วิธีชำระ) ใส่รหัสหรือชื่อที่มีในโปรแกรมได้'],
    ['', '', `${who}/สินค้าที่ยังไม่มีในโปรแกรม: ติ๊ก "เพิ่มข้อมูลหลักที่ยังไม่มีให้อัตโนมัติ" ตอนนำเข้า — ระบบเพิ่มให้พร้อมกับเอกสาร`],
    ...(cash ? [] : [['', '', 'บิลเดียวหลายสินค้า = หลายแถวที่เลขที่อ้างอิงเดียวกัน (ตัวอย่างแถว 2–3) · สินค้ามี VAT กับยกเว้น VAT ในบิลเดียว: ใส่ "ประเภท VAT" ต่อแถว 1 = มี VAT · 0 = ยกเว้น (ว่าง = ตามแฟ้มสินค้า)']]),
    ['', '', `เลขที่เอกสาร: เว้นว่าง = ระบบออกเลขตามประเภทเอกสาร · ใส่เอง = ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร (เช่น ${prefix}…) ไม่ซ้ำกับเอกสารใดในบริษัท (ตัวอย่างแถว 4) · เลขของโปรแกรมเดิม (ไม่ขึ้นต้นด้วย ${prefix}) ใส่ในคอลัมน์ "เลขที่อ้างอิง" — ระบบออกเลขให้ และค้นหาด้วยเลขเดิมได้`],
    ['', '', 'มีแฟ้มจากโปรแกรมอื่นอยู่แล้ว (รูปแบบไม่ตรงแบบฟอร์มนี้): ไม่ต้องคัดลอกมากรอก — เลือกแฟ้มนั้นที่หน้านำเข้าได้เลย ระบบจับคู่คอลัมน์ให้ (หรือกด "✨ ให้ AI จัดรูปแบบ") ตรวจการจับคู่ แล้วกดตรวจแฟ้ม/นำเข้า'],
    ...(checks.length ? [['', '', ''], ['คอลัมน์ตรวจยอด', '', 'ไม่มีในแบบฟอร์มนี้ — ใช้กับแฟ้มจากโปรแกรมอื่นที่มียอดภาษี/ยอดสุทธิ (เพิ่มคอลัมน์ชื่อนี้ได้)'], ...checks.map((c) => [c.th, importNeedLabel(c), c.hint])] : []),
    ...(hasPay ? [['', '', ''], [`แผ่น "${payName}"`, '', `แบ่ง${K.module === 'AR' ? 'รับ' : 'จ่าย'}หลายวิธี (เช่น เงินสด + เงินโอน): หนึ่งแถว = หนึ่งวิธี ใส่เลขที่อ้างอิงของเอกสาร · ยอดรวมทุกแถว = ยอดรวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย · วิธีเดียวใช้คอลัมน์ "วิธีชำระ" ในแผ่นนำเข้าได้ (ใช้ยอดทั้งเอกสาร) · ไม่ใส่ = เงินสดทั้งหมด · ใช้แผ่นนี้ได้เฉพาะแฟ้ม .xlsx`],
      ...pcols.map((c) => [c.th, importNeedLabel(c), c.hint])] : []),
    ...(!cash && !hasPay ? [['', '', `${K.label}ไม่มีการรับ/จ่ายเงินในเอกสาร — รับ/จ่ายชำระที่เมนูรับชำระหนี้/จ่ายชำระหนี้`]] : []),
    ...(hasPay && !cash ? [['', '', `${K.label}รับ/จ่ายเงินวันเดียวกัน — ไม่มีช่องเครดิต (วัน) · แฟ้มเดิมที่มีคอลัมน์นี้ยังนำเข้าได้ (ไม่ใช้ค่าในคอลัมน์ และแจ้งเตือน)`]] : []),
    ['', '', 'ลบแถวตัวอย่างก่อนใช้ · ชื่อหัวคอลัมน์ห้ามแก้ (สลับลำดับได้) · บันทึกเป็น .xlsx (หรือ .csv เฉพาะแผ่นนำเข้า)']];
  sheets.push({ name: 'คำอธิบาย', rows: help, widths: [26, 34, 110] });
  return buildXlsx(sheets);
}

const importBody = z.object({
  file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB'),
  doc_type_id: z.string({ required_error: 'เลือกประเภทเอกสาร' }).uuid('เลือกประเภทเอกสาร'),
  price_type: z.enum(['0', '1', '2']).optional(), vat_rate: z.union([z.number(), z.string()]).optional(), commit: z.boolean().default(false),
  /** เพิ่มลูกค้า/ผู้จำหน่าย/สินค้าที่ยังไม่มีให้อัตโนมัติ (HANDOFF 167 · หน้าจอติ๊กไว้เป็นค่าเริ่มต้น) — ไม่ส่ง = ไม่เพิ่ม (กุญแจ API/หน้าจอเดิม) */
  create_masters: z.boolean().default(false),
  /** ให้ AI จัดรูปแบบ Excel (HANDOFF 168): การจับคู่คอลัมน์ที่ผู้ใช้ยืนยัน · รหัสที่ยอมรับจากคำแนะนำ (แถว → รหัส) */
  mapping: mappingBody.optional(), codes: codesBody,
});
type Result = {
  /** file = เลขที่เอกสารตามแฟ้ม · auto = ระบบออกเลข (HANDOFF 170) */
  doc_no_source: 'file' | 'auto';
  /** ที่มาของการรับ/จ่ายชำระ: main = คอลัมน์วิธีชำระในแผ่นนำเข้า · sheet = แผ่นรับ/จ่ายชำระ · cash = เงินสดทั้งหมด */
  pay_source?: 'main' | 'sheet' | 'cash';
  /** ยอดภาษี/ยอดรวมตามแฟ้ม (คอลัมน์ตรวจยอด) · check = ตรง/ต่าง · null = แฟ้มไม่มียอด */
  file_vat?: string | null; file_net?: string | null; check?: 'ok' | 'diff' | null;
  /** จำนวนบรรทัดตามประเภท VAT (1 มี VAT · 0 ยกเว้น · 2 อัตรา 0%) */
  vat_lines?: Record<'0' | '1' | '2', number>;
  cash_amount?: string | null; other_amount?: string | null; payments?: number; ref: string; row: number; date: string; party_code: string; party_name: string | null; party_new: boolean; lines: number; new_items: number; amount: string | null; vat_amount: string | null; wht_amount: string | null; net_amount: string | null; doc_no: string | null; warnings: string[] };

export function tradeImportRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/trade-import/:path/template', async (req, reply) => {
    const a = requireCompany(req);
    const k = kindOf(parse(z.object({ path: z.string() }), req.params).path);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const party = await db.selectFrom(k.K.party === 'customer' ? 'md_customer' : 'md_supplier').select(['code', 'name']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').executeTakeFirst();
    const items = await db.selectFrom('md_item').select('code').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A')
      .where('item_type', 'in', k.cash ? ['5'] : ['0', '3']).orderBy('item_type').orderBy('code').limit(2).execute();
    const today = new Date().toISOString().slice(0, 10);
    const dt = await db.selectFrom('md_doc_type').select('code').where('company_id', '=', a.companyId).where('doc_class', '=', k.K.cls).where('status', '=', 'A').where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="import-${k.K.cls}.xlsx"`);
    return buildTemplate(k.K, { party: party?.code ?? null, partyName: party?.name ?? null, items: items.map((x) => x.code), date: formatDate(today, co.year_system as YearSystem), prefix: dt?.code ?? null }, k.cash);
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
    const target = k.cash ? 'expense' : 'trade';
    const sheets = readSheets(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const tf = transformTable(sheets[0]?.rows ?? [], target, b.mapping, b.codes);
    const rows = tf.table;
    const ys = co.year_system as YearSystem;
    const opt = { ...b, priceType, vatRate, dtId: dt.id, dtCode: dt.code };
    const run = k.cash ? importExpense(db, a, k.K, rows, ys, opt, paySheetOf(sheets)) : importTrade(db, a, k.K, rows, ys, opt, paySheetOf(sheets));
    const { results, issues, fileDocs, masters, ran, warnings } = await run;
    issues.sort((p, q) => p.row - q.row);
    results.sort((p, q) => p.row - q.row);   // บันทึกฉบับที่กำหนดเลขเองก่อน — แสดงตามลำดับในแฟ้ม
    // ตรวจแฟ้มไม่ผ่าน (ยังไม่ได้ลองบันทึก) = บอกจำนวนให้กดตรวจ · ลองบันทึกแล้วผิด = บอกข้อแรก
    if (b.commit && issues.length) throw badRequest(ran ? `นำเข้าไม่ได้ — ${issues[0]!.message} (แถว ${issues[0]!.row})` : `นำเข้าไม่ได้ — มีข้อผิดพลาด ${issues.length} รายการ กด "ตรวจแฟ้ม" ดูรายละเอียดแล้วแก้ในแฟ้ม`,
      issues.slice(0, 200).map((x) => ({ field: `row:${x.row}`, message: x.message })));
    if (b.commit) await logActivity(db, a, { module: K.module, action: 'IMPORT', docNo: results[0]?.doc_no ?? null, detail: { file: b.file_name, docs: results.length, first: results[0]?.doc_no, last: results.at(-1)?.doc_no,
      new_parties: masters.parties.map((p) => p.code), new_items: masters.items.map((i) => i.code), new_units: masters.units, mapped: tf.mapped, codes: Object.keys(b.codes ?? {}).length } });
    return { ok: !issues.length, committed: b.commit, price_type: priceType, vat_rate: vatRate, create_masters: b.create_masters, docs: results, errors: issues, file_docs: fileDocs, new_masters: masters, file_warnings: warnings,
      total_net: results.reduce((t, r) => t.plus(d(r.net_amount ?? 0)), ZERO).toFixed(2),
      // แถวที่มีคำอธิบายแต่ไม่มีรหัส (ให้หน้าจอแนะนำรหัส) · แถวที่การจับคู่ข้าม (รวม/หัวตารางซ้ำ/ว่าง)
      mapped: tf.mapped, skipped_rows: tf.skipped, row_shift: tf.rowShift, need_codes: b.commit ? [] : missingCodeRows(rows, target) };
  });
}

type Opt = z.infer<typeof importBody> & { priceType: '0' | '1' | '2'; vatRate: string; dtId: string; dtCode: string };
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
  if (!commit) for (const r of results) if (r.doc_no_source !== 'file') r.doc_no = null;
  return { results, units, ran: true };
}

/** ภาษีหัก ณ ที่จ่ายของเอกสาร (ซื้อเงินสด/ค่าใช้จ่ายอื่น): ฐาน = ยอดก่อน VAT · ใส่อัตรา = คำนวณภาษี · ใส่ยอด = คำนวณอัตรา · แบบ/ประเภทเงินได้ว่าง = ตามผู้จำหน่าย/อัตรา */
function whtEntry(w: ExpenseImportWht, base: ReturnType<typeof d>, sup: { wht_form: string | null; wht_income_desc: string | null } | undefined, tax: string | null) {
  const amount = w.amount ? d(w.amount) : base.times(d(w.rate!)).div(100).toDecimalPlaces(2);
  const rate = w.rate ?? (() => { const r = whtRateOf(amount, base); return r.rate ?? r.raw; })();
  const form = w.form ?? (wht50FormOf(sup?.wht_form, tax) === '3' ? 'S03' : 'S53');
  const income = w.income ?? sup?.wht_income_desc ?? WHT_INCOME_TYPES.find((t) => t.rate === d(rate || 0).toString())?.text ?? 'ค่าบริการ';
  return { form_type: form, income_type: income, rate: rate || '0', paid_amount: base.toFixed(2), tax_amount: amount.toFixed(2), condition: '1' as const };
}
/**
 * เลขที่เอกสารตามแฟ้ม (HANDOFF 170) — กติกาเดียวกับช่องเลขที่เอกสารบนหน้าจอ (docNoFor · ข้อกำหนดเจ้าของ 30/10/2569 "ต้องห้ามปล่อยผ่าน"):
 * ขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร = ใช้เลขนั้น (ห้ามซ้ำกับเอกสาร/ใบสำคัญใดในบริษัทที่ยังไม่ลบ — ฉบับยกเลิกยังจองเลข) · ใส่แค่ตัวนำหน้า = อัตโนมัติ
 * ไม่ขึ้นต้นด้วยตัวนำหน้า: แฟ้มไม่มีเลขที่อ้างอิงแยก (เลขของโปรแกรมเดิม เช่น RE-…) = เก็บเป็นเลขที่อ้างอิง ออกเลขอัตโนมัติ + เตือน · มีเลขที่อ้างอิงแยก = ผิด (ตั้งใจกำหนดเลขเอง)
 * คืน เลขที่อ้างอิง → เลขที่เอกสารที่ใช้
 */
async function fileNumbers(db: Db, companyId: string, prefix: string, ys: YearSystem, docs: Array<{ ref: string; row: number; doc_no: string | null }>, issues: ImportIssue[], warnings: string[]) {
  const P = prefix.toUpperCase();
  const own = new Map<string, string>(), asRef: string[] = [];
  for (const x of docs) {
    if (!x.doc_no || x.doc_no.toUpperCase() === P) continue;
    if (x.doc_no.toUpperCase().startsWith(P)) own.set(x.ref, x.doc_no);
    else if (x.ref === x.doc_no) asRef.push(x.doc_no);
    else issues.push({ row: x.row, message: `เลขที่เอกสาร ${x.doc_no} ต้องขึ้นต้นด้วย ${prefix} ตามประเภทเอกสารที่เลือก (เช่น ${prefix}${x.doc_no.replace(/^[A-Za-zก-๙]+/, '') || '0000001'}) — แก้ในคอลัมน์ "เลขที่เอกสาร" หรือเว้นว่างให้ระบบออกเลข` });
  }
  if (asRef.length) warnings.push(`เลขที่เอกสารในแฟ้ม ${asRef.length} ฉบับ (เช่น ${asRef[0]}) ไม่ขึ้นต้นด้วย ${prefix} ตามประเภทเอกสาร — เก็บเป็นเลขที่อ้างอิง (ค้นหาด้วยเลขเดิมได้) และออกเลขที่เอกสารอัตโนมัติ · ต้องการใช้เลขเอง: ใส่เลขที่ขึ้นต้นด้วย ${prefix}`);
  const nos = [...new Set(own.values())];
  if (nos.length) {
    const used = (await sql<{ no: string; date: string; status: string }>`SELECT doc_no AS no, doc_date::text AS date, doc_status AS status FROM doc_header WHERE company_id = ${companyId} AND deleted_at IS NULL AND doc_no = ANY(${nos}::text[])
        UNION ALL SELECT voucher_no, voucher_date::text, doc_status FROM gl_journal WHERE company_id = ${companyId} AND deleted_at IS NULL AND voucher_no = ANY(${nos}::text[])`.execute(db)).rows;
    for (const x of docs) {
      const no = own.get(x.ref);
      const u = no ? used.find((r) => r.no === no) : undefined;
      if (!no || !u) continue;
      issues.push({ row: x.row, message: `เลขที่เอกสาร ${no} มีอยู่แล้ว (ลงวันที่ ${formatDate(u.date.slice(0, 10), ys)}${u.status === 'C' ? ' · ยกเลิกแล้ว — ลบเอกสารนั้นก่อนจึงใช้เลขนี้ได้' : ''}) — เปลี่ยนเลขที่ หรือเว้นว่างให้ระบบออกเลข` });
      own.delete(x.ref);
    }
  }
  return own;
}
/** ฉบับที่กำหนดเลขเองบันทึกก่อน — เลขอัตโนมัติ (issueDocNo ข้ามเลขที่มีอยู่แล้ว) จึงไม่ชนเลขในแฟ้ม */
const ownFirst = <T extends { body: { doc_no?: string | null } }>(xs: T[]) => [...xs].sort((p, q) => Number(!!q.body.doc_no) - Number(!!p.body.doc_no));
const PRICE_TYPE_TH: Record<string, string> = { '1': '1 รวมภาษีแล้ว', '2': '2 แยกภาษี (ราคาก่อน VAT)' };
const fmt2 = (v: ReturnType<typeof d>) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/**
 * ตรวจยอดกับแฟ้ม (HANDOFF 170): ยอดภาษี/ราคาสุทธิตามแฟ้ม = รวมทุกบรรทัด (หรือยอดทั้งบิลที่ใส่ซ้ำทุกแถว) · ต่างเกิน 0.05 = เตือน (บันทึกได้) พร้อมบอกประเภทราคาที่ทำให้ตรง
 */
function fileCheck(lines: Array<{ vat_amount: string | null; net_total: string | null }>, vat: string | null, net: string | null, alt: { pt: string; vat: string; net: string } | null) {
  const pickFile = (vals: Array<string | null>, got: ReturnType<typeof d>) => {
    if (vals.every((v) => v === null)) return null;
    const sum = vals.reduce((t, v) => t.plus(d(v ?? 0)), ZERO);
    const one = vals.length > 1 && vals.every((v) => v !== null && v === vals[0]) ? d(vals[0]!) : null;
    return one && one.minus(got).abs().lt(sum.minus(got).abs()) ? one : sum;
  };
  const gv = d(vat ?? 0), gn = d(net ?? 0);
  const fv = pickFile(lines.map((l) => l.vat_amount), gv), fn = pickFile(lines.map((l) => l.net_total), gn);
  const warnings: string[] = [];
  const off = (f: ReturnType<typeof d> | null, g: ReturnType<typeof d>) => !!f && f.minus(g).abs().gt('0.05');
  if (off(fv, gv)) warnings.push(`ภาษี VAT ตามแฟ้ม ${fmt2(fv!.toDecimalPlaces(2))} · โปรแกรมคำนวณ ${fmt2(gv)} (ต่าง ${fmt2(fv!.minus(gv).abs().toDecimalPlaces(2))})`);
  if (off(fn, gn)) warnings.push(`ราคาสุทธิตามแฟ้ม ${fmt2(fn!.toDecimalPlaces(2))} · โปรแกรมคำนวณรวมทั้งสิ้น ${fmt2(gn)} (ต่าง ${fmt2(fn!.minus(gn).abs().toDecimalPlaces(2))})`);
  const fx = fn ?? null;
  if (warnings.length && alt && fx && !off(fx, d(alt.net)) && !off(fv, d(alt.vat))) warnings.push(`ถ้าเลือก "ประเภทราคาในแฟ้ม" เป็น ${PRICE_TYPE_TH[alt.pt]} ยอดจะตรงกับแฟ้ม — เปลี่ยนแล้วตรวจแฟ้มอีกครั้ง`);
  return { file_vat: fv ? fv.toDecimalPlaces(2).toFixed(2) : null, file_net: fn ? fn.toDecimalPlaces(2).toFixed(2) : null, check: fv || fn ? (warnings.length ? 'diff' as const : 'ok' as const) : null, warnings };
}
/** คอลัมน์ในแฟ้มที่หน้าจอเอกสารชนิดนี้ไม่มี → ไม่นำเข้า + เตือน (เช่น เครดิต (วัน) ของขายเงินสด — แฟ้มเดิมยังนำเข้าได้) */
function columnWarnings(present: string[], allowed: Set<string>, all: Array<{ key: string; th: string }>, label: string, cashSale: boolean) {
  return present.filter((k) => !allowed.has(k)).map((k) => {
    const th = all.find((c) => c.key === k)?.th ?? k;
    return `คอลัมน์ "${th}" ไม่มีในหน้าจอ${label} — ไม่นำเข้าค่าในคอลัมน์นี้${k === 'credit_days' && cashSale ? ' (รับ/จ่ายเงินวันเดียวกัน ไม่มีเครดิต)' : ''}`;
  });
}
/** แผ่นรับ/จ่ายชำระ → รายการต่อเลขที่อ้างอิง (แถวที่ไม่มีเอกสารในแผ่นนำเข้า = ผิด) */
function paySheetByRef(rows: string[][], ys: YearSystem, refs: string[], use: boolean, label: string, issues: ImportIssue[], warnings: string[]) {
  const by = new Map<string, ImportPayment[]>();
  if (!rows.some((r) => r.some((c) => String(c ?? '').trim()))) return by;
  if (!use) { warnings.push(`แผ่นรับ/จ่ายชำระไม่ใช้กับ${label} — ไม่นำเข้า`); return by; }
  const mp = mapPaymentImport(rows, ys);
  issues.push(...mp.errors);
  for (const p of mp.pays) {
    if (!refs.includes(p.ref)) { issues.push({ row: p.row, message: `แผ่นรับ/จ่ายชำระ: ไม่มีเลขที่อ้างอิง ${p.ref} ในแผ่นนำเข้า` }); continue; }
    by.set(p.ref, [...(by.get(p.ref) ?? []), p]);
  }
  return by;
}

/** ขาย/ซื้อ (IV HS DR CN RR HP CP DN): ทุกช่องของหน้าจอเอกสาร (HANDOFF 169) → saveTrade เดียวกับหน้าจอ */
async function importTrade(db: Db, a: Ctx, K: TradeKind, rows: string[][], ys: YearSystem, b: Opt, payRows: string[][]) {
  const { docs, errors, cols: present } = mapImport(rows, ys, K);
  const issues: ImportIssue[] = [...errors];
  const allowed = new Set<string>(importColumnsFor(K).map((c) => c.key));
  const warnings = columnWarnings(present, allowed, IMPORT_COLUMNS, K.label, !!K.payments);
  const own = await fileNumbers(db, a.companyId, b.dtCode, ys, docs, issues, warnings);
  const paysBy = paySheetByRef(payRows, ys, docs.map((x) => x.ref), !!K.payments, K.label, issues, warnings);
  const pp = await planParties(db, a.companyId, K.party, docs, { create: b.create_masters });
  const allLines = docs.flatMap((x) => x.lines);
  const ip = await planItems(db, a.companyId, allLines, { create: b.create_masters });
  const lineHit = new Map(allLines.map((l, i) => [l, ip.hits[i]!]));
  // ข้อมูลหลักที่จะเพิ่มจริง = ที่เอกสารผ่านการหาอ้างถึง
  const usedP = new Set<PlannedParty>(), usedI = new Set<PlannedItem>();
  issues.push(...await masterRightIssues(db, a, K.party, pp.planned, ip.planned));
  const R = await loadRefs(db, a.companyId);
  const method = K.payments ? await methodsOf(db, a.companyId, K.module === 'AR' ? 'R' : 'P') : null;
  // ค่าเริ่มต้นจากแฟ้มคู่ค้า (เหมือนเลือกคู่ค้าบนหน้าจอ): พนักงานขาย เขตการขาย ขนส่งโดย ส่วนลดท้ายบิล สถานที่ส่งประจำ
  const foundIds = pp.hits.flatMap((h) => (h.kind === 'found' ? [h.party.id] : []));
  const pdef = new Map((foundIds.length ? (K.party === 'customer'
    ? await sql<{ id: string; salesperson_id: string | null; sales_area_code: string | null; ship_via_code: string | null; discount_text: string | null; default_ship_to: string | null; wht_form: null; wht_income_desc: null }>`SELECT id, salesperson_id, sales_area_code, ship_via_code, discount_text, default_ship_to, NULL AS wht_form, NULL AS wht_income_desc
        FROM md_customer WHERE company_id = ${a.companyId} AND id = ANY(${foundIds}::uuid[])`.execute(db)
    : await sql<{ id: string; salesperson_id: null; sales_area_code: null; ship_via_code: string | null; discount_text: string | null; default_ship_to: null; wht_form: string | null; wht_income_desc: string | null }>`SELECT id, NULL AS salesperson_id, NULL AS sales_area_code, ship_via_code, discount_text, NULL AS default_ship_to, wht_form, wht_income_desc
        FROM md_supplier WHERE company_id = ${a.companyId} AND id = ANY(${foundIds}::uuid[])`.execute(db)).rows : []).map((r) => [r.id, r]));
  const shipTo = K.party === 'customer' ? await shipTosOf(db, a.companyId, foundIds) : null;

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
  const refs = docs.map((x) => x.ref);
  const prior = refs.length ? (await sql<{ your_ref: string; party: string; doc_no: string }>`SELECT your_ref, coalesce(customer_id, supplier_id) AS party, doc_no FROM doc_header
      WHERE company_id = ${a.companyId} AND doc_class = ${K.cls} AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : [];
  const notFound = (row: number, what: string, col: string, v: string, fix: string) => issues.push({ row, message: `ไม่พบ${what} "${v}" (คอลัมน์ "${col}") — ${fix}` });

  type Head = { department_id: string | null; project_id: string | null; salesperson_id: string | null; sales_area_code: string | null; ship_via_code: string | null; ship_to_id: string | null };
  type Ready = { doc: (typeof docs)[number]; party: PartyHit & { kind: 'found' | 'new' }; head: Head; lineRef: Map<(typeof allLines)[number], { wh: string | null; job: string | null }> };
  const ready: Ready[] = [];
  docs.forEach((doc, di) => {
    const n0 = issues.length;
    const h = pp.hits[di]!;
    if (h.kind === 'error') issues.push({ row: doc.row, message: h.message });
    else if (h.kind === 'found') {
      const dup = prior.find((x) => x.your_ref === doc.ref && x.party === h.party.id);
      if (dup) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref} เคยนำเข้าแล้วเป็น ${dup.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${dup.doc_no} ก่อน` });
    }
    if (K.refInvoice && !doc.ref_invoice) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref}: ${K.label}ต้องมี "อ้างใบกำกับ" (เลขที่ใบกำกับเดิม) — ใส่ในคอลัมน์ "อ้างใบกำกับ"` });
    // ช่องหัวเอกสาร: รหัสหรือชื่อ · ว่าง = ค่าเริ่มต้นเดียวกับหน้าจอ (ประเภทเอกสาร/แฟ้มคู่ค้า)
    const def = h.kind === 'found' ? pdef.get(h.party.id) : undefined;
    const head: Head = { department_id: null, project_id: null, salesperson_id: def?.salesperson_id ?? null, sales_area_code: def?.sales_area_code ?? null, ship_via_code: def?.ship_via_code ?? null, ship_to_id: null };
    if (doc.department) { const r = R.dept(doc.department); if (r) head.department_id = r.id; else notFound(doc.row, 'แผนก', 'แผนก', doc.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม (เริ่มระบบ › แผนก)'); }
    if (doc.project) { const r = R.job(doc.project); if (r) head.project_id = r.id; else notFound(doc.row, 'Job', 'Job/โครงการ', doc.project, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม'); }
    if (allowed.has('salesperson') && doc.salesperson) { const r = R.slm(doc.salesperson); if (r) head.salesperson_id = r.id; else notFound(doc.row, 'พนักงานขาย', 'พนักงานขาย', doc.salesperson, 'ใส่รหัสหรือชื่อพนักงานขายที่มีในโปรแกรม'); }
    if (allowed.has('sales_area') && doc.sales_area) { const r = R.area(doc.sales_area); if (r) head.sales_area_code = r.code; else notFound(doc.row, 'เขตการขาย', 'เขตการขาย', doc.sales_area, 'ใส่รหัสหรือชื่อในตารางข้อมูลเขตการขาย'); }
    if (doc.ship_via) { const r = R.via(doc.ship_via); if (r) head.ship_via_code = r.code; else notFound(doc.row, 'วิธีขนส่ง', 'ขนส่งโดย', doc.ship_via, 'ใส่รหัสหรือชื่อในตารางข้อมูลขนส่งโดย'); }
    if (shipTo && h.kind === 'found') {
      const v = allowed.has('ship_to') ? doc.ship_to ?? def?.default_ship_to ?? null : null;
      if (v) { const r = shipTo(h.party.id, v); if (r) head.ship_to_id = r.id; else if (doc.ship_to) notFound(doc.row, 'สถานที่ส่งของ', 'สถานที่ส่งของ', doc.ship_to, `ใส่รหัสสถานที่ส่งในแฟ้มลูกค้า ${h.party.code}`); }
    } else if (allowed.has('ship_to') && doc.ship_to) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref}: สถานที่ส่งของใช้ได้กับลูกค้าที่มีในโปรแกรมแล้ว — เพิ่มสถานที่ส่งที่รายละเอียดลูกค้าหลังนำเข้า` });
    const lineRef = new Map<(typeof allLines)[number], { wh: string | null; job: string | null }>();
    for (const l of doc.lines) {
      const ih = lineHit.get(l)!;
      if (ih.kind === 'error') issues.push({ row: l.row, message: ih.message });
      if (ih.kind === 'found' && l.unit && !unitOf(ih.item, l.unit)) issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้า ${ih.item.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้า (หรือเว้นว่าง)` });
      if (ih.kind === 'new' && l.unit && ih.plan.unit && l.unit.toUpperCase() !== ih.plan.unit.toUpperCase()) issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้าใหม่ ${ih.plan.code} (หน่วยย่อย ${ih.plan.unit} ตามแถว ${ih.plan.row})` });
      const wh = l.warehouse ? R.wh(l.warehouse) : undefined;
      if (l.warehouse && !wh) notFound(l.row, 'คลัง', 'คลัง', l.warehouse, 'ใส่รหัสหรือชื่อคลังที่มีในโปรแกรม (หรือเว้นว่าง = คลังตามประเภทเอกสาร)');
      const job = l.job ? R.job(l.job) : undefined;
      if (l.job && !job) notFound(l.row, 'Job', 'Job รายบรรทัด', l.job, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม');
      lineRef.set(l, { wh: wh?.id ?? null, job: job?.id ?? null });
    }
    if (issues.length > n0 || h.kind === 'error' || h.kind === 'name') return;
    if (h.kind === 'new') usedP.add(h.plan);
    for (const l of doc.lines) { const ih = lineHit.get(l)!; if (ih.kind === 'new') usedI.add(ih.plan); }
    ready.push({ doc, party: h, head, lineRef });
  });
  const { results, units, ran } = await tryAll(db, b.commit, issues,
    async () => {
      const r = await createMasters(db, a, K.party, [...usedP], [...usedI], b.file_name);
      unitBy = await loadUnits();   // รวมหน่วยที่เพิ่งเพิ่มให้สินค้าใหม่
      return r.units;
    },
    () => ownFirst(ready.flatMap((x) => {
      const lines = x.doc.lines.map((l) => {
        const ih = lineHit.get(l)!;
        const it = ih.kind === 'found' ? ih.item : ih.kind === 'new' ? { id: ih.plan.id!, code: ih.plan.code, base_unit_id: ih.plan.unit_id ?? null, sales_unit_id: null, sales_factor: null, purchase_unit_id: null, purchase_factor: null, vat_code: null } : null;
        if (!it) return null;
        const u = unitOf(it, l.unit);
        if (!u) { issues.push({ row: l.row, message: `หน่วย ${l.unit} ไม่ใช่หน่วยของสินค้า ${it.code} — ใช้หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้า (หรือเว้นว่าง)` }); return null; }
        const lr = x.lineRef.get(l)!;
        // ว่าง = ค่าเริ่มต้นของหน้าจอ: Job ตามหัวเอกสาร · ใบลดหนี้/ส่งคืนคืนสินค้าเข้า/ออกสต๊อก · ประเภท VAT ตามแฟ้มสินค้า
        return { item_id: it.id, description: l.description, warehouse_id: lr.wh, qty: l.qty, unit_id: u.unitId, factor: u.factor, unit_price: l.price, discount_text: l.discount,
          is_free: !!l.free, project_id: lr.job ?? x.head.project_id, ...(l.vat_code ? { vat_code: l.vat_code } : {}), return_to_stock: K.cls === 'CN' || K.cls === 'DN' ? l.ret ?? true : false,
          _vat: l.vat_code ?? it.vat_code ?? '1' };
      });
      if (lines.some((l) => !l)) return [];
      const party = x.party.kind === 'found' ? { id: x.party.party.id, code: x.party.party.code, name: x.party.party.name, tax: x.party.party.tax_id, isNew: false, branch: x.party.branch ?? x.doc.party_branch }
        : { id: x.party.plan.id!, code: x.party.plan.code, name: x.party.plan.name, tax: x.party.plan.tax_id, isNew: true, branch: null };
      const def = x.party.kind === 'found' ? pdef.get(x.party.party.id) : undefined;
      const discount = x.doc.bill_discount ?? def?.discount_text ?? null;
      let payments: unknown[] = [], wht: unknown[] = [], whtAmount = '0';
      // ยอดแบบเดียวกับหน้าจอ (ยอดที่ต้องรับ/จ่าย) + ประเภทราคาอีกแบบ (บอกผู้ใช้เมื่อยอดไม่ตรงกับแฟ้ม)
      const calcOf = (pt: '1' | '2' | '0') => computeDoc({ price_type: pt, vat_rate: b.vatRate, discount_text: discount, lines: lines.map((l) => ({ qty: l!.qty, unit_price: l!.is_free ? 0 : l!.unit_price, discount_text: l!.discount_text, vat_code: l!._vat })) });
      const calc = calcOf(b.priceType);
      const altPt = b.priceType === '1' ? '2' : b.priceType === '2' ? '1' : null;
      const alt = altPt ? (() => { const c = calcOf(altPt); return { pt: altPt, vat: c.vat_amount, net: c.net_amount }; })() : null;
      const vatLines = { '0': 0, '1': 0, '2': 0 } as Record<'0' | '1' | '2', number>;
      for (const l of lines) vatLines[(l!._vat === '0' || l!._vat === '2' ? l!._vat : '1') as '0' | '1' | '2']++;
      const sheet = paysBy.get(x.doc.ref) ?? [];
      const paySource = !K.payments ? undefined : sheet.length ? 'sheet' as const : x.doc.pay_method ? 'main' as const : 'cash' as const;
      if (K.payments) {
        // ยอดที่ต้องรับ/จ่าย = รวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย (คิดแบบเดียวกับหน้าจอ)
        let w = d(0);
        if (x.doc.wht && K.cls === 'HS') { w = d(x.doc.wht.amount ?? 0); whtAmount = w.toFixed(2); }
        if (x.doc.wht && K.cls === 'HP') { const e = whtEntry(x.doc.wht, d(calc.net_amount).minus(d(calc.vat_amount)), def ? { wht_form: def.wht_form, wht_income_desc: def.wht_income_desc } : undefined, party.tax); w = d(e.tax_amount); wht = [e]; }
        const p = buildPayments({ ref: x.doc.ref, row: x.doc.row, due: d(calc.net_amount).minus(w).toFixed(2), label: K.label, recv: K.module === 'AR', main: { method: x.doc.pay_method, pay_ref: x.doc.pay_ref }, sheet, method: method!, issues });
        if (!p) return [];
        payments = p.map(({ cheque_date: _c, ...q }) => q);
      }
      return [{ doc: x.doc, party, newItems: x.doc.lines.filter((l) => lineHit.get(l)!.kind === 'new').length, alt, vatLines, paySource,
        body: { doc_type_id: b.dtId, doc_no: own.get(x.doc.ref) ?? null, doc_date: x.doc.date, party_id: party.id, ...(party.branch ? { party_tax_branch_no: party.branch } : {}), your_ref: x.doc.ref,
          ref_no: K.refInvoice ? x.doc.ref_invoice : x.doc.ref_no, ...(K.module === 'AP' && !K.refInvoice && x.doc.ref_date ? { ref_date: x.doc.ref_date } : {}),
          credit_days: K.payments ? null : x.doc.credit_days, price_type: b.priceType, vat_rate: b.vatRate, ...(x.doc.vat_basis ? { vat_basis: x.doc.vat_basis } : {}), discount_text: discount, remark: x.doc.remark,
          ...x.head, lines: lines.map((l) => { const { _vat: _v, ...rest } = l!; return rest; }), payments, wht, wht_amount: whtAmount } }];
    })),
    async (x) => {
      const r = await saveTrade(db, a, K, null, parse(tradeBody, x.body));
      const h = await db.selectFrom('doc_header').select(['amount_after_discount', 'vat_amount', 'wht_amount', 'net_amount', 'cash_amount', 'cheque_amount']).where('id', '=', r.id!).executeTakeFirstOrThrow();
      const chk = fileCheck(x.doc.lines, h.vat_amount, h.net_amount, x.alt);
      return { ref: x.doc.ref, row: x.doc.row, date: x.doc.date, party_code: x.party.code, party_name: x.party.name, party_new: x.party.isNew, lines: x.doc.lines.length, new_items: x.newItems,
        amount: h.amount_after_discount, vat_amount: h.vat_amount, wht_amount: K.payments ? h.wht_amount : null, net_amount: h.net_amount, doc_no: r.doc_no, doc_no_source: x.body.doc_no ? 'file' as const : 'auto' as const,
        warnings: [...r.warnings, ...chk.warnings], file_vat: chk.file_vat, file_net: chk.file_net, check: chk.check, vat_lines: x.vatLines,
        ...(K.payments ? { cash_amount: h.cash_amount, other_amount: h.cheque_amount, payments: (x.body.payments as unknown[]).length, pay_source: x.paySource } : {}) };
    });
  return { results, issues, fileDocs: docs.length, masters: mastersOf(pp.planned, ip.planned, units), ran, warnings };
}

/** บันทึกค่าใช้จ่ายอื่น ๆ (OE): รหัสค่าใช้จ่าย + จำนวนเงิน · หัวเอกสารครบตามหน้าจอ · ภาษีหัก ณ ที่จ่าย · จ่ายชำระโดยวิธีอื่น → saveCash เดียวกับหน้าจอ */
async function importExpense(db: Db, a: Ctx, K: CashKind, rows: string[][], ys: YearSystem, b: Opt, payRows: string[][]) {
  const { docs, errors } = mapExpenseImport(rows, ys);
  const issues: ImportIssue[] = [...errors];
  const warnings: string[] = [];
  const own = await fileNumbers(db, a.companyId, b.dtCode, ys, docs, issues, warnings);
  const paysBy = paySheetByRef(payRows, ys, docs.map((x) => x.ref), true, K.label, issues, warnings);
  const pp = await planParties(db, a.companyId, 'supplier', docs, { create: b.create_masters, nameOnly: true });
  issues.push(...await masterRightIssues(db, a, 'supplier', pp.planned, []));
  const R = await loadRefs(db, a.companyId);
  const method = await methodsOf(db, a.companyId, 'P');
  const items = (await sql<{ id: string; code: string; name: string; item_type: string; status: string; vat_code: string | null }>`SELECT id, code, name_th AS name, item_type, status, vat_code FROM md_item
      WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND item_type IN ('5', '2')`.execute(db)).rows;
  const findCode = finder(items);
  const itemOf = (v: string) => { const r = findCode(v); return r ? items.find((i) => i.id === r.id) : undefined; };
  const others = new Map((await sql<{ code: string }>`SELECT code FROM md_item WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND item_type NOT IN ('5', '2')`.execute(db)).rows.map((r) => [r.code.toUpperCase(), r.code]));
  const supIds = pp.hits.flatMap((h) => (h.kind === 'found' ? [h.party.id] : []));
  const sups = new Map((supIds.length ? (await sql<{ id: string; wht_form: string | null; wht_income_desc: string | null; wht_rate: string | null }>`SELECT id, wht_form, wht_income_desc, wht_rate FROM md_supplier
      WHERE company_id = ${a.companyId} AND id = ANY(${supIds}::uuid[])`.execute(db)).rows : []).map((x) => [x.id, x]));
  const refs = docs.map((x) => x.ref);
  const prior = refs.length ? (await sql<{ your_ref: string; party: string | null; party_name: string | null; doc_no: string }>`SELECT your_ref, supplier_id AS party, party_name, doc_no FROM doc_header
      WHERE company_id = ${a.companyId} AND doc_class = ${K.cls} AND doc_status <> 'C' AND deleted_at IS NULL AND your_ref = ANY(${refs}::text[])`.execute(db)).rows : [];
  const notFound = (row: number, what: string, col: string, v: string, fix: string) => issues.push({ row, message: `ไม่พบ${what} "${v}" (คอลัมน์ "${col}") — ${fix}` });
  const usedP = new Set<PlannedParty>();
  type Ready = { doc: (typeof docs)[number]; party: PartyHit; dept: string | null; job: string | null; lineJob: Map<(typeof docs)[number]['lines'][number], string | null> };
  const ready: Ready[] = [];
  docs.forEach((doc, di) => {
    const n0 = issues.length;
    const h = pp.hits[di]!;
    if (h.kind === 'error') issues.push({ row: doc.row, message: h.message });
    const dup = h.kind === 'found' ? prior.find((x) => x.your_ref === doc.ref && x.party === h.party.id) : h.kind === 'name' ? prior.find((x) => x.your_ref === doc.ref && !x.party && (x.party_name ?? '').trim() === h.name.trim()) : undefined;
    if (dup) issues.push({ row: doc.row, message: `เลขที่อ้างอิง ${doc.ref} เคยนำเข้าแล้วเป็น ${dup.doc_no} — ลบแถวนี้ออก หรือยกเลิก ${dup.doc_no} ก่อน` });
    const dept = doc.department ? R.dept(doc.department) : undefined, job = doc.project ? R.job(doc.project) : undefined;
    if (doc.department && !dept) notFound(doc.row, 'แผนก', 'แผนก', doc.department, 'ใส่รหัสหรือชื่อแผนกที่มีในโปรแกรม');
    if (doc.project && !job) notFound(doc.row, 'Job', 'Job/โครงการ', doc.project, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม');
    const lineJob = new Map<(typeof doc.lines)[number], string | null>();
    for (const l of doc.lines) {
      const it = itemOf(l.code);
      if (!it) issues.push({ row: l.row, message: others.has(l.code.toUpperCase()) ? `${others.get(l.code.toUpperCase())} ไม่ใช่รหัสค่าใช้จ่ายอื่น — ใช้รหัสจาก ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ`
        : `ไม่พบรหัสค่าใช้จ่าย ${l.code} — เพิ่มที่ ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ ก่อน (ระบบไม่เพิ่มให้ เพราะต้องกำหนดบัญชีค่าใช้จ่าย)` });
      else if (it.status === 'I') issues.push({ row: l.row, message: `รหัสค่าใช้จ่าย ${it.code} เลิกใช้แล้ว` });
      const lj = l.job ? R.job(l.job) : undefined;
      if (l.job && !lj) notFound(l.row, 'Job', 'Job รายบรรทัด', l.job, 'ใส่รหัสหรือชื่อ Job ที่มีในโปรแกรม');
      lineJob.set(l, lj?.id ?? null);
    }
    if (issues.length > n0 || h.kind === 'error') return;
    if (h.kind === 'new') usedP.add(h.plan);
    ready.push({ doc, party: h, dept: dept?.id ?? null, job: job?.id ?? null, lineJob });
  });
  const { results, units, ran } = await tryAll(db, b.commit, issues,
    async () => (await createMasters(db, a, 'supplier', [...usedP], [], b.file_name)).units,
    () => ownFirst(ready.flatMap((x) => {
      const p = x.party;
      const party = p.kind === 'found' ? { id: p.party.id, code: p.party.code, name: p.party.name, tax: p.party.tax_id, isNew: false, branch: p.branch ?? x.doc.party_branch }
        : p.kind === 'new' ? { id: p.plan.id!, code: p.plan.code, name: p.plan.name, tax: p.plan.tax_id, isNew: true, branch: null } : { id: null, code: '', name: (p as { name: string }).name, tax: x.doc.party_tax_id, isNew: false, branch: null };
      const lines = x.doc.lines.map((l) => { const it = itemOf(l.code)!; return { item_id: it.id, description: l.description, amount: l.amount, vat_code: it.vat_code, project_id: x.lineJob.get(l) ?? x.job }; });
      const calc = computeDoc({ price_type: b.priceType, vat_rate: b.vatRate, lines: lines.map((l) => ({ qty: 1, unit_price: l.amount, vat_code: l.vat_code })) });
      let wht: unknown[] = [], w = d(0);
      if (x.doc.wht) { const e = whtEntry(x.doc.wht, d(calc.net_amount).minus(d(calc.vat_amount)), party.id ? sups.get(party.id) : undefined, party.tax); wht = [e]; w = d(e.tax_amount); }
      const sheet = paysBy.get(x.doc.ref) ?? [];
      const payments = buildPayments({ ref: x.doc.ref, row: x.doc.row, due: d(calc.net_amount).minus(w).toFixed(2), label: K.label, recv: false, main: { method: x.doc.pay_method, pay_ref: x.doc.pay_ref }, sheet, method, issues });
      if (!payments) return [];
      const paySource = sheet.length ? 'sheet' as const : x.doc.pay_method ? 'main' as const : 'cash' as const;
      return [{ doc: x.doc, party, paySource, body: { doc_type_id: b.dtId, doc_no: own.get(x.doc.ref) ?? null, doc_date: x.doc.date, party_id: party.id, party_name: party.id ? null : party.name, ...(party.branch ? { party_tax_branch_no: party.branch } : {}),
        your_ref: x.doc.ref, ref_no: x.doc.ref_no, ...(x.doc.ref_date ? { ref_date: x.doc.ref_date } : {}), department_id: x.dept, project_id: x.job,
        price_type: b.priceType, vat_rate: b.vatRate, remark: x.doc.remark, lines: lines.map(({ vat_code: _v, ...l }) => l), payments, wht } }];
    })),
    async (x) => {
      const r = await saveCash(db, a, K, null, parse(cashBody, x.body), { keyed: true });
      const h = await db.selectFrom('doc_header').select(['amount_after_discount', 'vat_amount', 'wht_amount', 'net_amount', 'cash_amount', 'cheque_amount']).where('id', '=', r.id!).executeTakeFirstOrThrow();
      return { ref: x.doc.ref, row: x.doc.row, date: x.doc.date, party_code: x.party.code, party_name: x.party.name, party_new: x.party.isNew, lines: x.doc.lines.length, new_items: 0,
        amount: h.amount_after_discount, vat_amount: h.vat_amount, wht_amount: h.wht_amount, net_amount: h.net_amount, doc_no: r.doc_no, doc_no_source: x.body.doc_no ? 'file' as const : 'auto' as const, warnings: r.warnings,
        cash_amount: h.cash_amount, other_amount: h.cheque_amount, payments: (x.body.payments as unknown[]).length, pay_source: x.paySource };
    });
  return { results, issues, fileDocs: docs.length, masters: mastersOf(pp.planned, [], units), ran, warnings };
}
