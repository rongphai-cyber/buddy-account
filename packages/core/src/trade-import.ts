import { parseDateInput, type YearSystem } from './date.js';

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * แฟ้มหนึ่งแถว = สินค้าหนึ่งบรรทัด · แถวที่ "เลขที่อ้างอิง" เดียวกันรวมเป็นเอกสารเดียว (ตามลำดับในแฟ้ม)
 * ส่วนนี้อ่านตาราง (xlsx/csv ที่คลายแล้ว) → เอกสารร่าง + ข้อผิดพลาดรายแถว · การหารหัสและบันทึกอยู่ที่เซิร์ฟเวอร์
 */
export interface ImportColumn { key: ImportKey; th: string; aliases: string[]; required?: boolean; hint: string; example: [string, string] }
export type ImportKey = 'ref' | 'date' | 'party' | 'item' | 'description' | 'qty' | 'unit' | 'price' | 'discount' | 'warehouse' | 'ref_invoice' | 'credit_days' | 'remark';

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่เอกสาร', 'เลขที่บิล', 'อ้างอิง', 'ref', 'docno'], required: true, hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บไว้ในช่อง "อ้างอิง" ของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ', example: ['INV-0001', 'INV-0001'] },
  { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] },
  { key: 'party', th: 'รหัสคู่ค้า', aliases: ['รหัสลูกค้า', 'รหัสผู้จำหน่าย', 'ลูกค้า', 'ผู้จำหน่าย', 'คู่ค้า', 'customer', 'supplier'], required: true, hint: 'รหัสลูกค้า (เอกสารขาย) หรือรหัสผู้จำหน่าย (เอกสารซื้อ) ที่มีในโปรแกรมแล้ว', example: ['C001', 'C001'] },
  { key: 'item', th: 'รหัสสินค้า', aliases: ['สินค้า', 'บาร์โค้ด', 'item', 'sku'], required: true, hint: 'รหัสสินค้าหรือบาร์โค้ด ที่มีในโปรแกรมแล้ว', example: ['A-001', 'S-001'] },
  { key: 'description', th: 'รายละเอียด', aliases: ['ชื่อสินค้า', 'description'], hint: 'ว่าง = ใช้ชื่อสินค้าในโปรแกรม', example: ['', 'ค่าติดตั้ง'] },
  { key: 'qty', th: 'จำนวน', aliases: ['qty', 'quantity'], required: true, hint: 'ตัวเลข', example: ['2', '1'] },
  { key: 'unit', th: 'หน่วย', aliases: ['หน่วยนับ', 'unit'], hint: 'รหัสหน่วยนับ ว่าง = หน่วยย่อยของสินค้า (หน่วยขาย/หน่วยซื้อใช้ตัวคูณของสินค้า)', example: ['', ''] },
  { key: 'price', th: 'ราคาต่อหน่วย', aliases: ['ราคา', 'ราคา/หน่วย', 'price'], required: true, hint: 'ตามประเภทราคาที่เลือกตอนนำเข้า (รวมหรือแยกภาษี)', example: ['150', '500'] },
  { key: 'discount', th: 'ส่วนลด', aliases: ['discount'], hint: 'เช่น 50 หรือ 10% หรือ 5+2%', example: ['10%', ''] },
  { key: 'warehouse', th: 'คลัง', aliases: ['รหัสคลัง', 'warehouse'], hint: 'รหัสคลัง ว่าง = ตามประเภทเอกสาร/คลังหลัก', example: ['', ''] },
  { key: 'ref_invoice', th: 'อ้างใบกำกับ', aliases: ['ใบกำกับเดิม', 'อ้างถึงใบกำกับ'], hint: 'เฉพาะใบลดหนี้/เพิ่มหนี้: เลขที่ใบกำกับเดิม', example: ['', ''] },
  { key: 'credit_days', th: 'เครดิต (วัน)', aliases: ['เครดิต', 'จำนวนวันเครดิต', 'credit'], hint: 'ว่าง = ตามรายละเอียดลูกค้า/ผู้จำหน่าย', example: ['30', '30'] },
  { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note'], hint: 'หมายเหตุของเอกสาร', example: ['นำเข้าจากหน้าร้าน', ''] },
];
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_DOCS = 500;

export interface ImportLine { row: number; item: string; description: string | null; qty: string; unit: string | null; price: string; discount: string | null; warehouse: string | null }
export interface ImportDoc { ref: string; row: number; date: string; party: string; ref_invoice: string | null; credit_days: number | null; remark: string | null; lines: ImportLine[] }
export interface ImportIssue { row: number; message: string }

const norm = (s: string) => s.replace(/[\s_\-().]/g, '').toLowerCase();

/** วันที่จากแฟ้ม: ช่องวันที่ของ Excel (เลขลำดับวัน) · ปปปป-ดด-วว · วว/ดด/ปปปป ตามระบบปีของบริษัท */
export function importDate(v: string, ys: YearSystem): string | null {
  const t = v.trim();
  if (/^\d{5,7}(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n < 20000 || n > 2958465) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    // Excel เครื่องไทยรับ "15/10/2569" เป็นวันที่ปี ค.ศ. 2569 — ปีเกิน 2400 ถือเป็น พ.ศ.
    const y = dt.getUTCFullYear();
    return y > 2400 ? parseDateInput(`${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${y}`, 'B') : dt.toISOString().slice(0, 10);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) { const y = Number(iso[1]); return parseDateInput(`${iso[3]}/${iso[2]}/${y > 2400 ? y : y + 543}`, 'B'); }
  // ปีสี่หลักบอกระบบปีได้เอง (> 2400 = พ.ศ.) ไม่ขึ้นกับค่าบริษัท
  const four = /^\d{1,2}[/.\-]\d{1,2}[/.\-](\d{4})$/.exec(t);
  if (four) return parseDateInput(t, Number(four[1]) > 2400 ? 'B' : 'C');
  return parseDateInput(t, ys);
}

/** ตัวเลขจากแฟ้ม: ตัดจุลภาคหลักพัน ช่องว่าง ฿ · (100) = −100 */
export function importNumber(v: string): string | null {
  let t = v.trim().replace(/[,\s฿]/g, '');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // ค่าจาก Excel อาจมีเศษทศนิยมยาว (เช่น 0.1+0.2) — ตัดที่ 6 ตำแหน่ง
  return /e/i.test(t) || /\.\d{7,}/.test(t) ? String(Math.round(n * 1e6) / 1e6) : t.replace(/^(-?)\./, '$10.');
}

/**
 * ตาราง (แถว × ช่อง) → เอกสาร · หาหัวตารางจากชื่อคอลัมน์ (แถวแรกที่ตรงอย่างน้อย 3 ชื่อ) ลำดับคอลัมน์สลับได้
 * row ในผลลัพธ์ = เลขแถวในแฟ้ม (เริ่ม 1) ให้ผู้ใช้ไปแก้ได้ตรงแถว
 */
export function mapImport(rows: string[][], ys: YearSystem): { docs: ImportDoc[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const lookup = new Map<string, ImportKey>();
  for (const c of IMPORT_COLUMNS) for (const n of [c.th, ...c.aliases]) lookup.set(norm(n), c.key);
  let headAt = -1;
  const cols = new Map<ImportKey, number>();
  for (let r = 0; r < Math.min(rows.length, 20) && headAt < 0; r++) {
    const hits = rows[r]!.map((x, i) => [lookup.get(norm(String(x ?? ''))), i] as const).filter((x): x is readonly [ImportKey, number] => !!x[0]);
    if (hits.length >= 3) { headAt = r; for (const [k, i] of hits) if (!cols.has(k)) cols.set(k, i); }
  }
  if (headAt < 0) return { docs: [], errors: [{ row: 1, message: `ไม่พบหัวตาราง — แถวแรกต้องมีชื่อคอลัมน์ เช่น ${IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.th).join(', ')} (ดาวน์โหลดแบบฟอร์มตัวอย่าง)` }] };
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !cols.has(c.key));
  if (missing.length) return { docs: [], errors: [{ row: headAt + 1, message: `ไม่มีคอลัมน์ ${missing.map((c) => `"${c.th}"`).join(', ')} — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง` }] };
  const cell = (r: string[], k: ImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(r[i] ?? '').trim(); };
  const docs = new Map<string, ImportDoc>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const bad = (m: string) => errors.push({ row: no, message: m });
    const ref = cell(row, 'ref'), party = cell(row, 'party'), item = cell(row, 'item');
    if (!ref) { bad('ไม่มีเลขที่อ้างอิง'); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const date = importDate(cell(row, 'date'), ys);
    if (!date) bad(`วันที่ "${cell(row, 'date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    if (!party) bad('ไม่มีรหัสคู่ค้า');
    if (!item) bad('ไม่มีรหัสสินค้า');
    const qty = importNumber(cell(row, 'qty'));
    if (qty === null) bad(`จำนวน "${cell(row, 'qty')}" ไม่ใช่ตัวเลข`);
    const price = importNumber(cell(row, 'price') || '0');
    if (price === null) bad(`ราคาต่อหน่วย "${cell(row, 'price')}" ไม่ใช่ตัวเลข`);
    const cd = cell(row, 'credit_days');
    const credit = cd ? Number(cd.replace(/,/g, '')) : null;
    if (credit !== null && !(Number.isInteger(credit) && credit >= 0 && credit <= 999)) bad(`เครดิต "${cd}" ต้องเป็นจำนวนวัน 0–999`);
    if (!date || !party || !item || qty === null || price === null || ref.length > 30) continue;
    const head = { date, party, ref_invoice: cell(row, 'ref_invoice') || null, credit_days: credit, remark: cell(row, 'remark') || null };
    let doc = docs.get(ref);
    if (!doc) {
      if (docs.size >= MAX_IMPORT_DOCS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_DOCS} เอกสาร — แบ่งเป็นหลายแฟ้ม`); break; }
      doc = { ref, row: no, ...head, lines: [] };
      docs.set(ref, doc);
    } else {
      // ข้อมูลหัวเอกสารต้องตรงกันทุกแถวของเลขที่เดียวกัน (ช่องว่าง = ตามแถวแรก)
      const before = errors.length;
      if (doc.date !== date) bad(`เลขที่อ้างอิง ${ref}: วันที่ไม่ตรงกับแถว ${doc.row}`);
      if (doc.party.toUpperCase() !== party.toUpperCase()) bad(`เลขที่อ้างอิง ${ref}: รหัสคู่ค้าไม่ตรงกับแถว ${doc.row}`);
      if (head.ref_invoice && doc.ref_invoice && head.ref_invoice !== doc.ref_invoice) bad(`เลขที่อ้างอิง ${ref}: อ้างใบกำกับไม่ตรงกับแถว ${doc.row}`);
      if (errors.length > before) continue;
      doc.ref_invoice ??= head.ref_invoice; doc.credit_days ??= head.credit_days; doc.remark ??= head.remark;
    }
    doc.lines.push({ row: no, item, description: cell(row, 'description') || null, qty, unit: cell(row, 'unit') || null, price, discount: cell(row, 'discount') || null, warehouse: cell(row, 'warehouse') || null });
  }
  if (!docs.size && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { docs: [...docs.values()], errors };
}

/* ------------------------------------------------------------ อ่านแฟ้ม */

/** CSV (Excel "บันทึกเป็น CSV") — คั่นด้วย , ; หรือแท็บ · รองรับช่องในเครื่องหมายคำพูด */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.slice(0, t.search(/\r?\n|$/));
  const sep = [',', ';', '\t'].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const out: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}

const unXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[e.toLowerCase()]!);
/** ข้อความใน <t> ทั้งหมดของช่วงนี้ (ข้อความหลายรูปแบบ <r><t> ต่อกัน · ข้ามคำอ่าน <rPh>) */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unXml(m[1] ?? '')).join('');

/** xl/sharedStrings.xml → ข้อความตามลำดับ */
export function xlsxSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textOf(m[1] ?? ''));
}

/** เลขคอลัมน์จากอ้างอิงช่อง เช่น C5 → 2 */
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** xl/worksheets/sheetN.xml → ตาราง (ช่องว่างเติม '' · ตัวเลขคงรูปข้อความเดิม) */
export function xlsxSheetRows(xml: string, shared: string[]): string[][] {
  const out: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1] ?? rm[3] ?? '');
    const at = rAttr ? Number(rAttr[1]) - 1 : out.length;
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d*)"/.exec(attrs);
      const ci = ref ? colIndex(ref[1]!) : next;
      next = ci + 1;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v !== undefined ? unXml(v) : '';
      while (cells.length < ci) cells.push('');
      cells[ci] = val;
    }
    while (out.length < at) out.push([]);
    out[at] = cells;
  }
  return out;
}
