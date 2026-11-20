import { parseDateInput, type YearSystem } from './date.js';
import { checkTaxId } from './taxid.js';
import { CASH_KINDS, TRADE_KINDS } from './doc-calc.js';

/** ชนิดเอกสารที่นำเข้าจาก Excel ได้: ขาย/ซื้อที่ลงบัญชี + บันทึกค่าใช้จ่ายอื่น ๆ (HANDOFF 167) — ปุ่ม "นำเข้า Excel" บนหน้าเอกสารเหล่านี้ */
export interface ImportDocKind { path: string; cls: string; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; route: string; cash?: boolean }
const OE_KIND = CASH_KINDS.find((k) => k.cls === 'OE')!;
export const IMPORT_DOC_KINDS: ImportDocKind[] = [
  ...TRADE_KINDS.filter((k) => !k.order).map(({ path, cls, module, menu, party, label, route }) => ({ path, cls, module, menu, party, label, route })),
  { path: OE_KIND.path, cls: OE_KIND.cls, module: OE_KIND.module, menu: OE_KIND.menu, party: OE_KIND.party, label: OE_KIND.label, route: OE_KIND.route, cash: true },
];
export const importPathOf = (cls: string) => IMPORT_DOC_KINDS.find((k) => k.cls === cls)?.path ?? null;

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * แฟ้มหนึ่งแถว = สินค้าหนึ่งบรรทัด · แถวที่ "เลขที่อ้างอิง" เดียวกันรวมเป็นเอกสารเดียว (ตามลำดับในแฟ้ม)
 * ส่วนนี้อ่านตาราง (xlsx/csv ที่คลายแล้ว) → เอกสารร่าง + ข้อผิดพลาดรายแถว · การหารหัสและบันทึกอยู่ที่เซิร์ฟเวอร์
 */
export interface ImportColumn {
  key: ImportKey; th: string; aliases: string[]; required?: boolean; hint: string; example: [string, string];
  /** คอลัมน์ที่แทนกันได้ (รหัสว่างได้ถ้ามีชื่อ — เพิ่มข้อมูลหลักใหม่ HANDOFF 167) */
  alt?: ImportKey;
  /** ใช้เฉพาะเมื่อเพิ่มลูกค้า/ผู้จำหน่าย/สินค้าใหม่ */
  forNew?: boolean;
}
export type ImportKey = 'ref' | 'date' | 'party' | 'party_name' | 'item' | 'item_name' | 'description' | 'qty' | 'unit' | 'price' | 'discount' | 'warehouse' | 'ref_invoice' | 'credit_days' | 'remark'
  | 'party_tax_id' | 'party_branch' | 'party_address' | 'party_phone' | 'item_kind';

/** คอลัมน์ข้อมูลหลักใหม่ (ลูกค้า/ผู้จำหน่าย) — ใช้ร่วมกับแบบนำเข้าค่าใช้จ่ายอื่น */
const PARTY_NEW_COLS = {
  party_name: { key: 'party_name', th: 'ชื่อคู่ค้า', aliases: ['ชื่อลูกค้า', 'ชื่อผู้จำหน่าย', 'ชื่อผู้ขาย'], forNew: true, hint: 'ชื่อลูกค้า/ผู้จำหน่าย — ใช้เมื่อเพิ่มรายใหม่ หรือหารายเดิมเมื่อไม่ใส่รหัส', example: ['ร้านตัวอย่าง', 'ร้านตัวอย่าง'] },
  party_tax_id: { key: 'party_tax_id', th: 'เลขผู้เสียภาษี', aliases: ['เลขประจำตัวผู้เสียภาษี', 'เลขผู้เสียภาษีอากร', 'taxid'], forNew: true, hint: 'รายใหม่: เลข 13 หลัก (ตรวจหลักตรวจสอบ) · ไม่ใส่รหัส = หารายเดิมจากเลขนี้ + สาขา', example: ['', ''] },
  party_branch: { key: 'party_branch', th: 'สาขา', aliases: ['เลขที่สาขา', 'สาขาที่', 'branch'], forNew: true, hint: 'เลขที่สาขา 5 หลัก ว่าง/สำนักงานใหญ่ = 00000', example: ['', ''] },
  party_address: { key: 'party_address', th: 'ที่อยู่', aliases: ['ที่อยู่ลูกค้า', 'ที่อยู่ผู้จำหน่าย', 'address'], forNew: true, hint: 'รายใหม่: ที่อยู่ (ไม่เกิน 300 ตัว)', example: ['', ''] },
  party_phone: { key: 'party_phone', th: 'โทรศัพท์', aliases: ['โทร', 'เบอร์โทร', 'phone'], forNew: true, hint: 'รายใหม่: เบอร์โทร', example: ['', ''] },
} satisfies Record<string, ImportColumn>;

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่เอกสาร', 'เลขที่บิล', 'อ้างอิง', 'ref', 'docno'], required: true, hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บไว้ในช่อง "อ้างอิง" ของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ', example: ['INV-0001', 'INV-0001'] },
  { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] },
  { key: 'party', th: 'รหัสคู่ค้า', aliases: ['รหัสลูกค้า', 'รหัสผู้จำหน่าย', 'ลูกค้า', 'ผู้จำหน่าย', 'คู่ค้า', 'customer', 'supplier'], required: true, alt: 'party_name', hint: 'รหัสลูกค้า (เอกสารขาย) หรือรหัสผู้จำหน่าย (เอกสารซื้อ) · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ (ติ๊ก "เพิ่มข้อมูลหลัก" ตอนนำเข้า) · ว่างได้ถ้ามีชื่อ', example: ['C001', 'C001'] },
  PARTY_NEW_COLS.party_name,
  { key: 'item', th: 'รหัสสินค้า', aliases: ['สินค้า', 'บาร์โค้ด', 'item', 'sku'], required: true, alt: 'item_name', hint: 'รหัสสินค้าหรือบาร์โค้ด · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้ถ้ามีชื่อสินค้า (หาจากชื่อ ไม่พบ = เพิ่มใหม่ ออกรหัสให้)', example: ['A-001', 'S-001'] },
  { key: 'item_name', th: 'ชื่อสินค้า', aliases: ['ชื่อสินค้า/บริการ', 'ชื่อบริการ'], forNew: true, hint: 'ชื่อสินค้า — ใช้เมื่อเพิ่มสินค้าใหม่ หรือหาสินค้าเดิมเมื่อไม่ใส่รหัส', example: ['', ''] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description'], hint: 'ว่าง = ใช้ชื่อสินค้าในโปรแกรม', example: ['', 'ค่าติดตั้ง'] },
  { key: 'qty', th: 'จำนวน', aliases: ['qty', 'quantity'], required: true, hint: 'ตัวเลข', example: ['2', '1'] },
  { key: 'unit', th: 'หน่วย', aliases: ['หน่วยนับ', 'unit'], hint: 'รหัสหน่วยนับ ว่าง = หน่วยย่อยของสินค้า (หน่วยขาย/หน่วยซื้อใช้ตัวคูณของสินค้า) · สินค้าใหม่: หน่วยย่อยของสินค้า (ไม่มีหน่วยนี้ = เพิ่มให้)', example: ['', ''] },
  { key: 'price', th: 'ราคาต่อหน่วย', aliases: ['ราคา', 'ราคา/หน่วย', 'price'], required: true, hint: 'ตามประเภทราคาที่เลือกตอนนำเข้า (รวมหรือแยกภาษี)', example: ['150', '500'] },
  { key: 'discount', th: 'ส่วนลด', aliases: ['discount'], hint: 'เช่น 50 หรือ 10% หรือ 5+2%', example: ['10%', ''] },
  { key: 'warehouse', th: 'คลัง', aliases: ['รหัสคลัง', 'warehouse'], hint: 'รหัสคลัง ว่าง = ตามประเภทเอกสาร/คลังหลัก', example: ['', ''] },
  { key: 'ref_invoice', th: 'อ้างใบกำกับ', aliases: ['ใบกำกับเดิม', 'อ้างถึงใบกำกับ'], hint: 'เฉพาะใบลดหนี้/เพิ่มหนี้: เลขที่ใบกำกับเดิม', example: ['', ''] },
  { key: 'credit_days', th: 'เครดิต (วัน)', aliases: ['เครดิต', 'จำนวนวันเครดิต', 'credit'], hint: 'ว่าง = ตามรายละเอียดลูกค้า/ผู้จำหน่าย', example: ['30', '30'] },
  { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note'], hint: 'หมายเหตุของเอกสาร', example: ['นำเข้าจากหน้าร้าน', ''] },
  PARTY_NEW_COLS.party_tax_id, PARTY_NEW_COLS.party_branch, PARTY_NEW_COLS.party_address, PARTY_NEW_COLS.party_phone,
  { key: 'item_kind', th: 'ชนิดสินค้า', aliases: ['ชนิด', 'สินค้าหรือบริการ'], forNew: true, hint: 'สินค้าใหม่: "สินค้า" หรือ "บริการ" (ว่าง = สินค้า)', example: ['', 'บริการ'] },
];
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_DOCS = 500;

/** ข้อมูลคู่ค้าจากแฟ้ม: code ว่าง = หาจากเลขผู้เสียภาษี+สาขา แล้วจากชื่อ (ไม่พบ = รายใหม่) */
export interface ImportParty { party: string; party_name: string | null; party_tax_id: string | null; party_branch: string | null; party_address: string | null; party_phone: string | null }
export interface ImportLine { row: number; item: string; item_name: string | null; item_kind: '0' | '3' | null; description: string | null; qty: string; unit: string | null; price: string; discount: string | null; warehouse: string | null }
export interface ImportDoc extends ImportParty { ref: string; row: number; date: string; ref_invoice: string | null; credit_days: number | null; remark: string | null; lines: ImportLine[] }
export interface ImportIssue { row: number; message: string }

const norm = (s: string) => s.replace(/[\s_\-().%]/g, '').toLowerCase();

/** เลขผู้เสียภาษีจาก Excel: ตัดช่องว่าง/ขีด · 1.0555E+12 → ตัวเลขเต็ม · Excel ตัดเลข 0 ข้างหน้า (12 หลัก) → เติม 0 เมื่อหลักตรวจสอบถูกต้องเท่านั้น
 * คืนค่าเดิมเมื่อแก้ไม่ได้ (ให้ตัวตรวจแจ้งข้อผิดพลาด) */
export function importTaxId(v: string): string {
  let t = v.replace(/[\s-]/g, '');
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(t)) { const n = importNumber(t); if (n && /^\d+$/.test(n)) t = n; }
  t = t.replace(/\.0+$/, '');
  if (/^\d{10,12}$/.test(t)) { const p = t.padStart(13, '0'); if (checkTaxId(p).ok) return p; }
  return t;
}
/** เลขที่สาขา: ว่าง/สำนักงานใหญ่ = null (ใช้ 00000) · ตัวเลขไม่เกิน 5 หลัก เติม 0 · อื่น ๆ = undefined (ผิด) */
export function importBranch(v: string): string | null | undefined {
  const t = v.trim().replace(/^สาขา(ที่)?\s*/, '');
  if (!t || /^(สำนักงานใหญ่|สนญ\.?|head\s*office|ho)$/i.test(t)) return null;
  const n = t.replace(/\.0+$/, '');
  return /^\d{1,5}$/.test(n) ? n.padStart(5, '0') : undefined;
}
/** ชนิดสินค้าใหม่: สินค้า = 0 · บริการ = 3 · ว่าง = null · อื่น ๆ = undefined (ผิด) */
export function importItemKind(v: string): '0' | '3' | null | undefined {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (['สินค้า', '0', 'stock', 'item', 'product'].includes(t)) return '0';
  if (['บริการ', '3', 'service', 'สินค้าบริการ'].includes(t)) return '3';
  return undefined;
}
/** กุญแจคู่ค้าของแถว (แถวในเอกสารเดียวกันต้องตรงกัน): รหัส → เลขผู้เสียภาษี+สาขา → ชื่อ */
export function importPartyKey(p: Pick<ImportParty, 'party' | 'party_name' | 'party_tax_id' | 'party_branch'>): string {
  if (p.party) return `C:${p.party.toUpperCase()}`;
  if (p.party_tax_id) return `T:${p.party_tax_id}/${p.party_branch ?? '00000'}`;
  return `N:${(p.party_name ?? '').trim().toLowerCase()}`;
}

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

/** หาหัวตารางจากชื่อคอลัมน์ (แถวแรกที่ตรงอย่างน้อย 3 ชื่อ ภายใน 20 แถวแรก) ลำดับคอลัมน์สลับได้ */
function findHeader<K extends string>(rows: string[][], columns: Array<{ key: K; th: string; aliases: readonly string[]; required?: boolean; alt?: K }>):
  { headAt: number; cols: Map<K, number> } | { error: ImportIssue } {
  const lookup = new Map<string, K>();
  for (const c of columns) for (const n of [c.th, ...c.aliases]) lookup.set(norm(n), c.key);
  let headAt = -1;
  const cols = new Map<K, number>();
  for (let r = 0; r < Math.min(rows.length, 20) && headAt < 0; r++) {
    const hits = rows[r]!.map((x, i) => [lookup.get(norm(String(x ?? ''))), i] as const).filter((x): x is readonly [K, number] => !!x[0]);
    if (hits.length >= 3) { headAt = r; for (const [k, i] of hits) if (!cols.has(k)) cols.set(k, i); }
  }
  if (headAt < 0) return { error: { row: 1, message: `ไม่พบหัวตาราง — แถวแรกต้องมีชื่อคอลัมน์ เช่น ${columns.filter((c) => c.required).map((c) => c.th).join(', ')} (ดาวน์โหลดแบบฟอร์มตัวอย่าง)` } };
  const missing = columns.filter((c) => c.required && !cols.has(c.key) && !(c.alt && cols.has(c.alt)));
  if (missing.length) return { error: { row: headAt + 1, message: `ไม่มีคอลัมน์ ${missing.map((c) => `"${c.th}"`).join(', ')} — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง` } };
  return { headAt, cols };
}

/** ข้อมูลคู่ค้าในแถว (รหัส ชื่อ เลขผู้เสียภาษี สาขา ที่อยู่ โทร) + ตรวจรูปแบบ */
function partyCells(cell: (k: ImportKey) => string, bad: (m: string) => void): ImportParty | null {
  const party = cell('party'), name = cell('party_name').slice(0, 120);
  const taxRead = cell('party_tax_id'), tax = taxRead ? importTaxId(taxRead) : '';
  let ok = true;
  if (tax) { const c = checkTaxId(tax); if (!c.ok) { bad(`เลขผู้เสียภาษี "${taxRead}" ${c.error}`); ok = false; } }
  const br = importBranch(cell('party_branch'));
  if (br === undefined) { bad(`สาขา "${cell('party_branch')}" ต้องเป็นเลขที่สาขา 5 หลัก (สำนักงานใหญ่ = 00000)`); ok = false; }
  if (party.length > 20) { bad(`รหัสคู่ค้า "${party}" ยาวเกิน 20 ตัว`); ok = false; }
  const addr = cell('party_address');
  if (addr.length > 300) { bad('ที่อยู่ยาวเกิน 300 ตัว'); ok = false; }
  return ok ? { party, party_name: name || null, party_tax_id: tax || null, party_branch: br ?? null, party_address: addr || null, party_phone: cell('party_phone').slice(0, 60) || null } : null;
}
/** แถวต่อมาของเอกสารเดียวกัน: คู่ค้าต้องตรงกับแถวแรก · ช่องที่แถวแรกว่างเติมจากแถวนี้ */
function samePartyOrBad(doc: ImportParty & { ref: string; row: number }, p: ImportParty, bad: (m: string) => void) {
  if (importPartyKey(doc) !== importPartyKey(p)) { bad(`เลขที่อ้างอิง ${doc.ref}: รหัสคู่ค้าไม่ตรงกับแถว ${doc.row}`); return false; }
  doc.party_name ??= p.party_name; doc.party_tax_id ??= p.party_tax_id; doc.party_branch ??= p.party_branch; doc.party_address ??= p.party_address; doc.party_phone ??= p.party_phone;
  return true;
}

/**
 * ตาราง (แถว × ช่อง) → เอกสาร · หาหัวตารางจากชื่อคอลัมน์ (แถวแรกที่ตรงอย่างน้อย 3 ชื่อ) ลำดับคอลัมน์สลับได้
 * row ในผลลัพธ์ = เลขแถวในแฟ้ม (เริ่ม 1) ให้ผู้ใช้ไปแก้ได้ตรงแถว
 * HANDOFF 167: รหัสคู่ค้า/สินค้าว่างได้ถ้ามีชื่อ (หรือเลขผู้เสียภาษี) — เซิร์ฟเวอร์หารายเดิม ไม่พบ = เพิ่มใหม่ · แฟ้มแบบเดิมยังนำเข้าได้เหมือนเดิม
 */
export function mapImport(rows: string[][], ys: YearSystem): { docs: ImportDoc[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const h = findHeader(rows, IMPORT_COLUMNS);
  if ('error' in h) return { docs: [], errors: [h.error] };
  const { headAt, cols } = h;
  const docs = new Map<string, ImportDoc>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const cell = (k: ImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: no, message: m });
    const ref = cell('ref'), item = cell('item'), itemName = cell('item_name').slice(0, 120);
    if (!ref) { bad('ไม่มีเลขที่อ้างอิง'); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const date = importDate(cell('date'), ys);
    if (!date) bad(`วันที่ "${cell('date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const p = partyCells(cell, bad);
    if (p && !p.party && !p.party_name && !p.party_tax_id) bad('ไม่มีรหัสคู่ค้า (คู่ค้าใหม่: ใส่ชื่อคู่ค้า)');
    if (!item && !itemName) bad('ไม่มีรหัสสินค้า (สินค้าใหม่: ใส่ชื่อสินค้า)');
    if (item.length > 30) bad(`รหัสสินค้า "${item}" ยาวเกิน 30 ตัว`);
    const kind = importItemKind(cell('item_kind'));
    if (kind === undefined) bad(`ชนิดสินค้า "${cell('item_kind')}" ใช้ "สินค้า" หรือ "บริการ"`);
    const qty = importNumber(cell('qty'));
    if (qty === null) bad(`จำนวน "${cell('qty')}" ไม่ใช่ตัวเลข`);
    const price = importNumber(cell('price') || '0');
    if (price === null) bad(`ราคาต่อหน่วย "${cell('price')}" ไม่ใช่ตัวเลข`);
    const cd = cell('credit_days');
    const credit = cd ? Number(cd.replace(/,/g, '')) : null;
    if (credit !== null && !(Number.isInteger(credit) && credit >= 0 && credit <= 999)) bad(`เครดิต "${cd}" ต้องเป็นจำนวนวัน 0–999`);
    if (!date || !p || (!p.party && !p.party_name && !p.party_tax_id) || (!item && !itemName) || item.length > 30 || kind === undefined || qty === null || price === null || ref.length > 30) continue;
    const head = { date, ref_invoice: cell('ref_invoice') || null, credit_days: credit, remark: cell('remark') || null };
    let doc = docs.get(ref);
    if (!doc) {
      if (docs.size >= MAX_IMPORT_DOCS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_DOCS} เอกสาร — แบ่งเป็นหลายแฟ้ม`); break; }
      doc = { ref, row: no, ...p, ...head, lines: [] };
      docs.set(ref, doc);
    } else {
      // ข้อมูลหัวเอกสารต้องตรงกันทุกแถวของเลขที่เดียวกัน (ช่องว่าง = ตามแถวแรก)
      const before = errors.length;
      if (doc.date !== date) bad(`เลขที่อ้างอิง ${ref}: วันที่ไม่ตรงกับแถว ${doc.row}`);
      if (errors.length === before) samePartyOrBad(doc, p, bad);
      if (head.ref_invoice && doc.ref_invoice && head.ref_invoice !== doc.ref_invoice) bad(`เลขที่อ้างอิง ${ref}: อ้างใบกำกับไม่ตรงกับแถว ${doc.row}`);
      if (errors.length > before) continue;
      doc.ref_invoice ??= head.ref_invoice; doc.credit_days ??= head.credit_days; doc.remark ??= head.remark;
    }
    // แฟ้มเก่าที่ใช้หัว "ชื่อสินค้า" เป็นรายละเอียด (ไม่มีคอลัมน์ รายละเอียด) — ยังได้รายละเอียดเหมือนเดิม
    const description = cell('description') || (!cols.has('description') && itemName ? itemName : '') || null;
    doc.lines.push({ row: no, item, item_name: itemName || null, item_kind: kind, description, qty, unit: cell('unit') || null, price, discount: cell('discount') || null, warehouse: cell('warehouse') || null });
  }
  if (!docs.size && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { docs: [...docs.values()], errors };
}

/* ------------------------------------------------------------ ค่าใช้จ่ายอื่น ๆ (OE · HANDOFF 167) */

export type ExpenseImportKey = 'ref' | 'date' | 'party' | 'party_name' | 'code' | 'description' | 'amount' | 'wht_rate' | 'wht_amount' | 'wht_income' | 'wht_form' | 'remark'
  | 'party_tax_id' | 'party_branch' | 'party_address' | 'party_phone';
export interface ExpenseImportColumn { key: ExpenseImportKey; th: string; aliases: readonly string[]; required?: boolean; hint: string; example: [string, string]; forNew?: boolean; alt?: ExpenseImportKey }
export const EXPENSE_IMPORT_COLUMNS: ExpenseImportColumn[] = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่เอกสาร', 'เลขที่บิล', 'อ้างอิง', 'ref', 'docno'], required: true, hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บในช่อง "อ้างอิง" ของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ', example: ['EXP-0001', 'EXP-0001'] },
  { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] },
  { key: 'party', th: 'รหัสผู้จำหน่าย', aliases: ['ผู้จำหน่าย', 'รหัสคู่ค้า', 'supplier'], hint: 'รหัสผู้จำหน่าย · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้: ใส่ชื่อผู้จำหน่าย (มีเลขผู้เสียภาษี = หา/เพิ่มในทะเบียน · ชื่ออย่างเดียวที่ไม่มีในทะเบียน = ใส่ชื่อในเอกสาร ไม่เพิ่มผู้จำหน่าย)', example: ['S001', 'S001'] },
  { ...PARTY_NEW_COLS.party_name, key: 'party_name', aliases: ['ชื่อผู้จำหน่าย', 'ชื่อผู้ขาย', 'ชื่อคู่ค้า', 'ผู้รับเงิน'], hint: 'ชื่อผู้จำหน่าย/ผู้รับเงิน — ใช้เมื่อไม่ใส่รหัส หรือเพิ่มผู้จำหน่ายใหม่' },
  { key: 'code', th: 'รหัสค่าใช้จ่าย', aliases: ['รหัส', 'ค่าใช้จ่าย', 'รหัสค่าใช้จ่ายอื่น', 'expense'], required: true, hint: 'รหัสค่าใช้จ่ายอื่นที่มีในโปรแกรมแล้ว (ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ — ต้องมีบัญชีค่าใช้จ่าย จึงไม่เพิ่มให้อัตโนมัติ)', example: ['E-001', 'E-002'] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description', 'คำอธิบาย'], hint: 'ว่าง = ชื่อรหัสค่าใช้จ่าย', example: ['ค่าขนส่งเดือน ต.ค.', ''] },
  { key: 'amount', th: 'จำนวนเงิน', aliases: ['ยอดเงิน', 'จำนวน', 'amount'], required: true, hint: 'ตามประเภทราคาที่เลือกตอนนำเข้า (รวมหรือแยกภาษี)', example: ['1000', '250'] },
  { key: 'wht_rate', th: 'อัตราหัก ณ ที่จ่าย', aliases: ['อัตราภาษีหัก ณ ที่จ่าย', 'หัก ณ ที่จ่าย %', 'อัตรา wht', 'whtrate'], hint: 'ร้อยละ เช่น 3 — ต่อเอกสาร (ใส่แถวใดแถวหนึ่ง) · ฐาน = ยอดก่อน VAT ของเอกสาร', example: ['3', ''] },
  { key: 'wht_amount', th: 'ภาษีหัก ณ ที่จ่าย', aliases: ['หัก ณ ที่จ่าย', 'ยอดภาษีหัก ณ ที่จ่าย', 'wht'], hint: 'ว่าง = ฐาน × อัตรา · ใส่ยอดอย่างเดียวได้ (คำนวณอัตราให้)', example: ['', ''] },
  { key: 'wht_income', th: 'ประเภทเงินได้', aliases: ['ประเภทเงินได้ที่จ่าย', 'เงินได้'], hint: 'เช่น ค่าบริการ ค่าขนส่ง ค่าเช่า ค่าโฆษณา · ว่าง = ตามอัตรา (3% ค่าบริการ 1% ค่าขนส่ง 2% ค่าโฆษณา 5% ค่าเช่า)', example: ['ค่าขนส่ง', ''] },
  { key: 'wht_form', th: 'แบบ ภ.ง.ด.', aliases: ['ภ.ง.ด.', 'ภงด', 'แบบ'], hint: '3 หรือ 53 · ว่าง = ตามผู้จำหน่าย (นิติบุคคล = 53)', example: ['53', ''] },
  { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note'], hint: 'หมายเหตุของเอกสาร', example: ['', ''] },
  { ...PARTY_NEW_COLS.party_tax_id, key: 'party_tax_id' }, { ...PARTY_NEW_COLS.party_branch, key: 'party_branch' }, { ...PARTY_NEW_COLS.party_address, key: 'party_address' }, { ...PARTY_NEW_COLS.party_phone, key: 'party_phone' },
];
export interface ExpenseImportWht { rate: string | null; amount: string | null; income: string | null; form: 'S03' | 'S53' | null }
export interface ExpenseImportLine { row: number; code: string; description: string | null; amount: string }
export interface ExpenseImportDoc extends ImportParty { ref: string; row: number; date: string; remark: string | null; wht: ExpenseImportWht | null; lines: ExpenseImportLine[] }

/** แบบ ภ.ง.ด. จากแฟ้ม: 3 / ภ.ง.ด.3 / S03 → S03 · 53 → S53 · ว่าง = null · อื่น ๆ = undefined */
export function importWhtForm(v: string): 'S03' | 'S53' | null | undefined {
  const t = v.replace(/[\s.]/g, '').toUpperCase().replace(/^(ภงด|PND|S)/, '');
  if (!t) return null;
  if (t === '53') return 'S53';
  if (t === '3' || t === '03') return 'S03';
  return undefined;
}

/** แฟ้มค่าใช้จ่ายอื่น ๆ → เอกสาร (หนึ่งแถว = รหัสค่าใช้จ่ายหนึ่งบรรทัด · ภาษีหัก ณ ที่จ่ายต่อเอกสาร) */
export function mapExpenseImport(rows: string[][], ys: YearSystem): { docs: ExpenseImportDoc[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const h = findHeader(rows, EXPENSE_IMPORT_COLUMNS);
  if ('error' in h) return { docs: [], errors: [h.error] };
  const { headAt, cols } = h;
  const docs = new Map<string, ExpenseImportDoc>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const cell = (k: ExpenseImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: no, message: m });
    const n0 = errors.length;
    const ref = cell('ref'), code = cell('code');
    if (!ref) { bad('ไม่มีเลขที่อ้างอิง'); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const date = importDate(cell('date'), ys);
    if (!date) bad(`วันที่ "${cell('date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const p = partyCells((k) => cell(k as ExpenseImportKey), bad);
    if (p && !p.party && !p.party_name && !p.party_tax_id) bad('ไม่มีรหัสหรือชื่อผู้จำหน่าย');
    if (!code) bad('ไม่มีรหัสค่าใช้จ่าย');
    const amount = importNumber(cell('amount'));
    if (amount === null) bad(`จำนวนเงิน "${cell('amount')}" ไม่ใช่ตัวเลข`);
    else if (Number(amount) === 0) bad('จำนวนเงินเป็น 0');
    const rateT = cell('wht_rate').replace(/%$/, ''), amtT = cell('wht_amount');
    const rate = rateT ? importNumber(rateT) : null, wamt = amtT ? importNumber(amtT) : null;
    if (rateT && (rate === null || Number(rate) < 0 || Number(rate) > 100)) bad(`อัตราหัก ณ ที่จ่าย "${cell('wht_rate')}" ต้องเป็นร้อยละ 0–100`);
    if (amtT && (wamt === null || Number(wamt) < 0)) bad(`ภาษีหัก ณ ที่จ่าย "${amtT}" ไม่ใช่จำนวนเงิน`);
    const form = importWhtForm(cell('wht_form'));
    if (form === undefined) bad(`แบบ ภ.ง.ด. "${cell('wht_form')}" ใช้ 3 หรือ 53`);
    const income = cell('wht_income').slice(0, 60);
    if (errors.length > n0 || !p || !date || amount === null) continue;
    const hasWht = (rate !== null && Number(rate) > 0) || (wamt !== null && Number(wamt) > 0);
    const wht: ExpenseImportWht | null = hasWht ? { rate: rate !== null && Number(rate) > 0 ? rate : null, amount: wamt !== null && Number(wamt) > 0 ? wamt : null, income: income || null, form: form ?? null } : null;
    let doc = docs.get(ref);
    if (!doc) {
      if (docs.size >= MAX_IMPORT_DOCS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_DOCS} เอกสาร — แบ่งเป็นหลายแฟ้ม`); break; }
      doc = { ref, row: no, ...p, date, remark: cell('remark') || null, wht, lines: [] };
      docs.set(ref, doc);
    } else {
      const before = errors.length;
      if (doc.date !== date) bad(`เลขที่อ้างอิง ${ref}: วันที่ไม่ตรงกับแถว ${doc.row}`);
      if (errors.length === before) samePartyOrBad(doc, p, bad);
      if (wht && doc.wht && JSON.stringify(wht) !== JSON.stringify(doc.wht)) bad(`เลขที่อ้างอิง ${ref}: ภาษีหัก ณ ที่จ่ายไม่ตรงกับแถว ${doc.row} — ใส่แถวเดียวของเอกสาร`);
      if (errors.length > before) continue;
      doc.wht ??= wht; doc.remark ??= cell('remark') || null;
    }
    doc.lines.push({ row: no, code, description: cell('description') || null, amount });
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
