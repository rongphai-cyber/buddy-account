import { IMPORT_COLUMNS, EXPENSE_IMPORT_COLUMNS, importNumber } from './trade-import.js';
import { JOURNAL_IMPORT_COLUMNS, cleanImportCell } from './journal-import.js';

/**
 * ให้ AI จัดรูปแบบ Excel (เจ้าของ 20/11/2569 "ทำทาง ก" · HANDOFF 168)
 * แฟ้มรูปแบบไหนก็ได้ (OCR โปรแกรมอื่น) → Claude ดูเฉพาะหัวตาราง + ตัวอย่างไม่เกิน 20 แถว แล้วตอบ "การจับคู่" (ไม่ใช่ข้อมูลที่แปลงแล้ว)
 * → applyMapping แปลงทุกแถวแบบตายตัว (ฟังก์ชันนี้ ไม่ใช้ AI) เป็นตารางตามแบบฟอร์มของ Buddy → ขั้นตรวจ/นำเข้าเดิม
 * การจับคู่ที่ผู้ใช้ยืนยันเก็บต่อบริษัท + ชนิดเอกสาร + ลายมือหัวตาราง (headerSignature) — แฟ้มรูปแบบเดิมครั้งต่อไปไม่ต้องเรียก AI
 */
export type ImportMapTarget = 'trade' | 'expense' | 'journal';
export type MapFormat = 'date' | 'number' | 'text';
export interface MapColumn { key: string; th: string; required: boolean; alt?: string; format: MapFormat; hint: string }
/** ช่องที่ "แนะนำรหัส" เติมให้ และช่องข้อความที่ใช้หา (HANDOFF 168 ข้อ 6) */
export const MAP_CODE_COLUMN: Record<ImportMapTarget, { code: string; text: string[]; amount: string[] }> = {
  trade: { code: 'item', text: ['description', 'item_name'], amount: ['price'] },
  expense: { code: 'code', text: ['description'], amount: ['amount'] },
  journal: { code: 'account', text: ['line_description', 'description'], amount: ['debit', 'credit'] },
};
/** ช่องที่เป็นกุญแจรวมแถวเป็นเอกสารเดียว + ช่องหัวเอกสารที่แถวต่อ ๆ ไปเว้นว่างได้ (group = continue) */
const GROUP: Record<ImportMapTarget, { key: string; head: string[] }> = {
  trade: { key: 'ref', head: ['date', 'party', 'party_name', 'party_tax_id', 'party_branch', 'party_address', 'party_phone', 'ref_invoice', 'credit_days', 'remark'] },
  expense: { key: 'ref', head: ['date', 'party', 'party_name', 'party_tax_id', 'party_branch', 'party_address', 'party_phone', 'remark'] },
  journal: { key: 'group', head: ['book', 'voucher_no', 'date', 'ref', 'description'] },
};
const TRADE_NUM = new Set(['qty', 'price', 'credit_days']);
const EXP_NUM = new Set(['amount', 'wht_rate', 'wht_amount']);
/** คอลัมน์ของแบบฟอร์มปลายทาง (ใช้กับหน้าจับคู่และข้อความถึง AI) */
export function mapColumns(target: ImportMapTarget): MapColumn[] {
  if (target === 'journal') return JOURNAL_IMPORT_COLUMNS.map((c) => ({ key: c.key, th: c.th, required: !!c.required, format: c.format === 'date' ? 'date' : c.format === 'number' ? 'number' : 'text', hint: c.hint }));
  if (target === 'expense') return EXPENSE_IMPORT_COLUMNS.map((c) => ({ key: c.key, th: c.th, required: !!c.required, ...(c.alt ? { alt: c.alt } : {}), format: c.key === 'date' ? 'date' : EXP_NUM.has(c.key) ? 'number' : 'text', hint: c.hint }));
  return IMPORT_COLUMNS.map((c) => ({ key: c.key, th: c.th, required: !!c.required, ...(c.alt ? { alt: c.alt } : {}), format: c.key === 'date' ? 'date' : TRADE_NUM.has(c.key) ? 'number' : 'text', hint: c.hint }));
}

export interface ImportMapping {
  /** แถวหัวตาราง (เริ่ม 0) · −1 = ไม่มีหัว (ข้อมูลเริ่มแถวแรก) */
  header_row: number;
  columns: Array<{ target: string; source: number; constant: string }>;
  date_order: 'dmy' | 'mdy' | 'ymd';
  year: 'be' | 'ce' | 'auto';
  decimal: 'dot' | 'comma';
  /** column = ช่องเลขที่อ้างอิง/กลุ่มเดียวกันเป็นเอกสารเดียว · continue = แถวที่ช่องนั้น (หรือวันที่) ว่างต่อจากเอกสารก่อนหน้า · row = แถวละเอกสาร */
  group: 'column' | 'continue' | 'row';
  /** แถวที่มีคำเหล่านี้ (เช่น รวม ยอดยกไป) ไม่นำเข้า */
  skip_words: string[];
  notes: string;
}

const str = { type: 'string' } as const;
/** โครงคำตอบของ AI (structured outputs) — ไม่มีช่อง null/union (กฎ HANDOFF 166) · ไม่มีค่า = "" หรือ −1 */
export function mapSchema(target: ImportMapTarget) {
  return {
    type: 'object', additionalProperties: false,
    required: ['header_row', 'columns', 'date_order', 'year', 'decimal', 'group', 'skip_words', 'notes'],
    properties: {
      header_row: { type: 'integer' },
      columns: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['target', 'source', 'constant'],
          properties: { target: { type: 'string', enum: mapColumns(target).map((c) => c.key) }, source: { type: 'integer' }, constant: str } },
      },
      date_order: { type: 'string', enum: ['dmy', 'mdy', 'ymd'] },
      year: { type: 'string', enum: ['be', 'ce', 'auto'] },
      decimal: { type: 'string', enum: ['dot', 'comma'] },
      group: { type: 'string', enum: ['column', 'continue', 'row'] },
      skip_words: { type: 'array', items: str },
      notes: str,
    },
  } as const;
}

export const MAP_SYSTEM_PROMPT = `คุณช่วยโปรแกรมบัญชีไทยจับคู่คอลัมน์ของแฟ้ม Excel/CSV ที่ผู้ใช้ได้มาจากที่อื่น (OCR โปรแกรมอื่น รายงานธนาคาร) เข้ากับแบบฟอร์มนำเข้าของโปรแกรม
คุณเห็นเฉพาะแถวต้นแฟ้ม (ไม่เกิน 25 แถว) — ตอบเป็น "การจับคู่" เท่านั้น ห้ามแปลงหรือแต่งข้อมูล โปรแกรมจะใช้การจับคู่นี้กับทุกแถวเอง และผู้ใช้จะตรวจก่อนนำเข้า
- header_row = เลขแถว (row ที่ให้มา เริ่ม 0) ที่เป็นหัวตาราง · ไม่มีหัวตาราง = -1
- columns: หนึ่งรายการต่อคอลัมน์ปลายทางที่หาได้ · source = เลขคอลัมน์ต้นทาง (เริ่ม 0) · ไม่มีในแฟ้มแต่ทั้งแฟ้มเป็นค่าเดียวกันที่รู้แน่ (เช่น สมุดรายวัน) ให้ source = -1 และ constant = ค่านั้น · ไม่มีและไม่รู้ = ไม่ต้องใส่ · constant ไม่ใช้ = ""
- อย่าจับคู่คอลัมน์ต้นทางเดียวกับหลายคอลัมน์ปลายทาง เว้นแต่จำเป็นจริง · คอลัมน์ยอดรวม/ภาษีที่คำนวณได้เองไม่ต้องจับคู่
- date_order ลำดับ วัน/เดือน/ปี ของวันที่ในแฟ้ม · year: be = ปี พ.ศ. · ce = ค.ศ. · auto = ปนกัน/ดูจากตัวเลข (เช่น 2569 = พ.ศ.)
- decimal: dot = 1,234.50 · comma = 1.234,50
- group: column = แถวที่เลขที่เอกสาร/เลขที่กลุ่มเดียวกันคือเอกสารเดียวกัน · continue = แถวที่ช่องเลขที่ (หรือวันที่) ว่างเป็นรายการต่อของเอกสารด้านบน · row = แถวละหนึ่งเอกสาร
- skip_words คำที่บอกว่าแถวนั้นไม่ใช่รายการ (เช่น "รวม", "ยอดยกไป", "Total") — ไม่มี = []
- notes ภาษาไทยสั้น ๆ: สิ่งที่ผู้ใช้ควรตรวจ (ถ้าไม่มี = "")`;

/** ข้อความถึง AI: คอลัมน์ปลายทาง + แถวต้นแฟ้ม (ช่องละไม่เกิน 60 ตัว) — ไม่ส่งทั้งแฟ้ม */
export function mapPrompt(target: ImportMapTarget, rows: string[][], label: string) {
  const sample = rows.slice(0, 25).map((r, i) => ({ row: i, cells: r.map((c) => cleanImportCell(c).slice(0, 60)) }));
  return [
    `แบบฟอร์มปลายทาง: ${label}`,
    `คอลัมน์ปลายทาง: ${JSON.stringify(mapColumns(target).map((c) => ({ key: c.key, name: c.th, required: c.required || undefined, format: c.format, hint: c.hint.slice(0, 120) })))}`,
    `แถวต้นแฟ้ม (row เริ่ม 0 · cells ตามลำดับคอลัมน์ เริ่ม 0): ${JSON.stringify(sample)}`,
  ].join('\n');
}
/** แถวที่ส่งให้ AI ได้ (ต้นแฟ้มไม่เกิน 25 แถว ตัดแถวว่างท้าย) */
export const MAP_SAMPLE_ROWS = 25;

/** ตรวจ/ทำความสะอาดคำตอบ (จาก AI หรือจากหน้าจอ) ให้ใช้ได้กับแฟ้มนี้ */
export function normalizeMapping(raw: Partial<ImportMapping> | null | undefined, target: ImportMapTarget, width: number): ImportMapping {
  const keys = new Set(mapColumns(target).map((c) => c.key));
  const seen = new Set<string>();
  const columns = (raw?.columns ?? []).filter((c) => c && keys.has(String(c.target)) && !seen.has(String(c.target)) && (seen.add(String(c.target)), true))
    .map((c) => ({ target: String(c.target), source: Number.isInteger(c.source) && c.source >= 0 && c.source < width ? c.source : -1, constant: String(c.constant ?? '').trim().slice(0, 60) }))
    .filter((c) => c.source >= 0 || c.constant);
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  return {
    header_row: Number.isInteger(raw?.header_row) ? Math.max(-1, Math.min(19, raw!.header_row!)) : 0,
    columns,
    date_order: pick(raw?.date_order, ['dmy', 'mdy', 'ymd'] as const, 'dmy'),
    year: pick(raw?.year, ['be', 'ce', 'auto'] as const, 'auto'),
    decimal: pick(raw?.decimal, ['dot', 'comma'] as const, 'dot'),
    group: pick(raw?.group, ['column', 'continue', 'row'] as const, 'column'),
    skip_words: (raw?.skip_words ?? []).map((w) => String(w).trim().slice(0, 30)).filter(Boolean).slice(0, 10),
    notes: String(raw?.notes ?? '').slice(0, 500),
  };
}
/** คอลัมน์บังคับที่ยังไม่ได้จับคู่ (ช่องที่แทนกันได้ เช่น รหัส/ชื่อ จับคู่ช่องใดช่องหนึ่งพอ · บัญชีเดบิต/เครดิตอย่างน้อยหนึ่งช่อง) */
export function unmappedRequired(m: ImportMapping, target: ImportMapTarget): MapColumn[] {
  const has = new Set(m.columns.map((c) => c.target));
  const out = mapColumns(target).filter((c) => c.required && !has.has(c.key) && !(c.alt && has.has(c.alt)));
  // เลขที่กลุ่ม/เลขที่อ้างอิง: รวมแถวแบบต่อเนื่อง/แถวละเอกสาร ไม่ต้องมีช่องนี้
  const g = GROUP[target].key;
  const res = m.group === 'column' ? out : out.filter((c) => c.key !== g);
  if (target === 'journal' && !has.has('debit') && !has.has('credit')) res.push(...mapColumns(target).filter((c) => c.key === 'debit'));
  return res;
}

const THAI_MONTH: Array<[RegExp, number]> = [
  [/^(ม\.?ค\.?|มกรา(คม)?|jan(uary)?)$/i, 1], [/^(ก\.?พ\.?|กุมภา(พันธ์)?|feb(ruary)?)$/i, 2], [/^(มี\.?ค\.?|มีนา(คม)?|mar(ch)?)$/i, 3], [/^(เม\.?ย\.?|เมษา(ยน)?|apr(il)?)$/i, 4],
  [/^(พ\.?ค\.?|พฤษภา(คม)?|may)$/i, 5], [/^(มิ\.?ย\.?|มิถุนา(ยน)?|jun(e)?)$/i, 6], [/^(ก\.?ค\.?|กรกฎา(คม)?|jul(y)?)$/i, 7], [/^(ส\.?ค\.?|สิงหา(คม)?|aug(ust)?)$/i, 8],
  [/^(ก\.?ย\.?|กันยา(ยน)?|sep(t|tember)?)$/i, 9], [/^(ต\.?ค\.?|ตุลา(คม)?|oct(ober)?)$/i, 10], [/^(พ\.?ย\.?|พฤศจิกา(ยน)?|nov(ember)?)$/i, 11], [/^(ธ\.?ค\.?|ธันวา(คม)?|dec(ember)?)$/i, 12],
];
const pad = (n: number) => String(n).padStart(2, '0');
/** วันที่ตามรูปแบบที่จับคู่ → ปปปป-ดด-วว (ค.ศ.) · ช่องวันที่ของ Excel (เลขลำดับวัน) คงไว้ให้ตัวนำเข้าแปลง · อ่านไม่ได้ = ค่าเดิม (ขั้นตรวจแจ้งแถวนั้น) */
export function mapDate(v: string, order: ImportMapping['date_order'], year: ImportMapping['year']): string {
  const t = cleanImportCell(v).replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*น\.?)?$/, '').trim();
  if (!t || /^\d{5,6}(\.\d+)?$/.test(t)) return t;
  // ชื่อเดือน (15 ต.ค. 2569 · 15 ตุลาคม 69 · 2026 Oct 15) — ไม่ตัดที่จุด (ตัวย่อเดือนมีจุด)
  if (/[ก-๙a-z]/i.test(t)) {
    const toks = t.split(/[\s/\-,]+/).filter(Boolean);
    const mi = toks.findIndex((x) => /[ก-๙a-z]/i.test(x));
    const m = mi >= 0 ? THAI_MONTH.find(([re]) => re.test(toks[mi]!))?.[1] : undefined;
    const nums = toks.filter((_, i) => i !== mi).map((x) => x.replace(/\.$/, ''));
    if (!m || toks.length !== 3 || !nums.every((x) => /^\d+$/.test(x))) return t;
    const [day, y] = order === 'ymd' || /^\d{4}$/.test(nums[0]!) ? [Number(nums[1]), Number(nums[0])] : [Number(nums[0]), Number(nums[1])];
    return toIso(day, m, y, year, t);
  }
  const parts = t.split(/[\s/.\-,]+/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return t;
  const n = parts.map(Number);
  const [d0, m0, y0] = /^\d{4}$/.test(parts[0]!) ? [n[2]!, n[1]!, n[0]!] : order === 'mdy' ? [n[1]!, n[0]!, n[2]!] : order === 'ymd' ? [n[2]!, n[1]!, n[0]!] : [n[0]!, n[1]!, n[2]!];
  return toIso(d0, m0, y0, year, t);
}
function toIso(day: number, month: number, y: number, year: ImportMapping['year'], raw: string) {
  let yy = y;
  // ปี 2 หลัก: พ.ศ. 69 → 2569 · ค.ศ. 26 → 2026 · auto: 50 ขึ้นไป = พ.ศ. · ปี 4 หลักเกิน 2400 = พ.ศ. เสมอ
  if (yy < 100) yy = year === 'ce' || (year === 'auto' && yy < 50) ? 2000 + yy : 2500 + yy;
  if (yy > 2400) yy -= 543;
  const dt = new Date(Date.UTC(yy, month - 1, day));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return raw;
  return `${yy}-${pad(month)}-${pad(day)}`;
}
/** ตัวเลขตามรูปแบบที่จับคู่: 1,234.50 · 1.234,50 · (500.00) · 500- · ฿ บาท · ขีดเดียว = ว่าง · อ่านไม่ได้ = ค่าเดิม */
export function mapNumber(v: string, decimal: ImportMapping['decimal']): string {
  let t = cleanImportCell(v).replace(/\s*(บาท|thb|฿)\s*/gi, '').replace(/\s+/g, '');
  if (!t || /^[-–—]$/.test(t)) return '';
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/^-/.test(t)) { neg = !neg; t = t.slice(1); }
  t = decimal === 'comma' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = importNumber(t);
  if (n === null) return cleanImportCell(v);
  return neg && n !== '0' ? `-${n.replace(/^-/, '')}` : n;
}

const normHead = (s: string) => cleanImportCell(s).replace(/[\s_\-().*%:]/g, '').toLowerCase();
/** ลายมือหัวตาราง (FNV-1a 32 บิต) — หัวเดิม = แฟ้มรูปแบบเดิม (ไม่สนช่องว่าง ตัวพิมพ์ เครื่องหมาย) */
export function headerSignature(row: string[] | undefined): string {
  const cells = (row ?? []).map((c) => normHead(String(c ?? '')));
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  const s = cells.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** กุญแจค่าตั้ง (sys_setting.key ไม่เกิน 40 ตัว) ของการจับคู่ที่บันทึก: ต่อชนิดเอกสาร + ลายมือหัวตาราง */
export const importMapKey = (cls: string, sig: string) => `imp.map.${cls}.${sig}`;

/**
 * ใช้การจับคู่กับทุกแถว → ตารางตามแบบฟอร์มของ Buddy (ตำแหน่งแถวเดิม — เลขแถวในข้อผิดพลาดตรงกับแฟ้มต้นฉบับ)
 * แถวหัวตาราง = ชื่อคอลัมน์ของแบบฟอร์ม · แถวว่าง/แถวที่มีคำในรายการข้าม/แถวหัวตารางซ้ำ (OCR หลายหน้า) = ว่าง (ไม่นำเข้า)
 * ไม่มีหัวตาราง (−1) = แทรกหัวไว้แถวแรก (เลขแถวเลื่อน 1)
 */
export function applyMapping(rows: string[][], m: ImportMapping, target: ImportMapTarget): { table: string[][]; skipped: number[]; rowShift: number } {
  const cols = mapColumns(target);
  const used = m.columns.map((c) => ({ ...c, col: cols.find((x) => x.key === c.target)! })).filter((c) => c.col);
  const g = GROUP[target];
  // ช่องกุญแจรวมแถว: ไม่ได้จับคู่ = เพิ่มให้ (เลขแถวเริ่มเอกสาร)
  const keyMapped = used.some((c) => c.target === g.key);
  const outCols = keyMapped ? used : [...used, { target: g.key, source: -1, constant: '', col: cols.find((x) => x.key === g.key)! }];
  const head = outCols.map((c) => c.col.th);
  const shift = m.header_row < 0 ? 1 : 0;
  const start = m.header_row + 1;
  const table: string[][] = Array.from({ length: rows.length + shift }, () => []);
  table[Math.max(0, m.header_row)] = head;
  const words = m.skip_words.map((w) => normHead(w)).filter(Boolean);
  const headSig = m.header_row >= 0 ? headerSignature(rows[m.header_row]) : '';
  const skipped: number[] = [];
  let curKey = '', prev: Record<string, string> = {};
  for (let r = Math.max(0, start); r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((x) => cleanImportCell(x))) continue;
    const no = r + 1 + shift;
    if ((headSig && headerSignature(row) === headSig) || (words.length && row.some((x) => { const t = normHead(String(x ?? '')); return !!t && words.some((w) => t === w || t.startsWith(w)); }))) { skipped.push(no); continue; }
    const v: Record<string, string> = {};
    for (const c of outCols) {
      const raw = c.constant || (c.source >= 0 ? String(row[c.source] ?? '') : '');
      v[c.target] = c.col.format === 'date' ? mapDate(raw, m.date_order, m.year) : c.col.format === 'number' ? mapNumber(raw, m.decimal) : cleanImportCell(raw);
    }
    // แถวที่ไม่มีค่าในช่องที่จับคู่เลย (เช่น บรรทัดหมายเหตุใต้ตาราง) = ข้าม
    if (!used.some((c) => !c.constant && v[c.target])) { skipped.push(no); continue; }
    if (m.group === 'row') v[g.key] = keyMapped && v[g.key] ? `${v[g.key]}#${no}` : `R${no}`;
    else if (m.group === 'continue') {
      const starts = keyMapped ? !!v[g.key] : !!v.date;
      if (starts || !curKey) { curKey = keyMapped && v[g.key] ? v[g.key]! : `R${no}`; prev = { ...v }; }
      v[g.key] = curKey;
      for (const k of g.head) if (!v[k] && prev[k]) v[k] = prev[k]!;
    } else if (!v[g.key]) v[g.key] = '';
    table[r + shift] = outCols.map((c) => v[c.target] ?? '');
  }
  return { table, skipped, rowShift: shift };
}

/** หัวตารางของตารางมาตรฐาน (หลัง applyMapping หรือแฟ้มตามแบบฟอร์ม) → ตำแหน่งคอลัมน์ต่อกุญแจ */
export function standardHeader(table: string[][], target: ImportMapTarget): { at: number; cols: Map<string, number> } | null {
  const all = target === 'journal' ? JOURNAL_IMPORT_COLUMNS : target === 'expense' ? EXPENSE_IMPORT_COLUMNS : IMPORT_COLUMNS;
  const lookup = new Map<string, string>();
  for (const c of all) for (const n of [c.th, ...c.aliases]) lookup.set(normHead(n), c.key);
  for (let r = 0; r < Math.min(table.length, 20); r++) {
    const hits = (table[r] ?? []).map((x, i) => [lookup.get(normHead(String(x ?? ''))), i] as const).filter((x): x is readonly [string, number] => !!x[0]);
    if (hits.length >= 3) { const cols = new Map<string, number>(); for (const [k, i] of hits) if (!cols.has(k)) cols.set(k, i); return { at: r, cols }; }
  }
  return null;
}
/** แถวที่มีคำอธิบายแต่ไม่มีรหัส (สินค้า/ค่าใช้จ่าย/บัญชี) — ให้ระบบแนะนำรหัส (ผู้ใช้ยืนยันเอง ไม่เติมเงียบ) */
export function missingCodeRows(table: string[][], target: ImportMapTarget): Array<{ row: number; text: string; amount: string }> {
  const h = standardHeader(table, target);
  if (!h) return [];
  const spec = MAP_CODE_COLUMN[target];
  const cell = (r: string[], k: string) => { const i = h.cols.get(k); return i === undefined ? '' : cleanImportCell(r[i]); };
  const out: Array<{ row: number; text: string; amount: string }> = [];
  for (let r = h.at + 1; r < table.length && out.length < 500; r++) {
    const row = table[r] ?? [];
    if (!row.some((x) => cleanImportCell(x))) continue;
    if (cell(row, spec.code)) continue;
    // สินค้าใหม่ที่ตั้งใจเพิ่ม (มีชื่อสินค้า) ไม่ต้องแนะนำ
    if (target === 'trade' && cell(row, 'item_name') && h.cols.has('description')) continue;
    const text = spec.text.map((k) => cell(row, k)).find(Boolean);
    if (!text) continue;
    out.push({ row: r + 1, text: text.slice(0, 200), amount: spec.amount.map((k) => cell(row, k)).find(Boolean) ?? '' });
  }
  return out;
}
/** ใส่รหัสที่ผู้ใช้ยอมรับลงตารางมาตรฐาน (เลขแถวในแฟ้ม → รหัส) · ไม่มีคอลัมน์รหัส = เพิ่มคอลัมน์ */
export function setImportCodes(table: string[][], target: ImportMapTarget, codes: Record<string, string>): string[][] {
  const entries = Object.entries(codes).filter(([, c]) => c);
  if (!entries.length) return table;
  const h = standardHeader(table, target);
  if (!h) return table;
  const key = MAP_CODE_COLUMN[target].code;
  const out = table.map((r) => [...r]);
  let i = h.cols.get(key);
  if (i === undefined) { i = Math.max(...out.map((r) => r.length)); out[h.at]![i] = mapColumns(target).find((c) => c.key === key)!.th; }
  for (const [row, code] of entries) {
    const r = Number(row) - 1;
    if (r <= h.at || r >= out.length || !out[r]?.some((x) => cleanImportCell(x))) continue;
    if (cleanImportCell(out[r]![i])) continue;          // มีรหัสในแฟ้มแล้ว ไม่ทับ
    while (out[r]!.length <= i) out[r]!.push('');
    out[r]![i] = code.slice(0, 30);
  }
  return out;
}

/** ข้อความถึง AI ให้แนะนำรหัสของแถวที่ไม่มีรหัส (เลือกได้เฉพาะรหัสในรายการ — ตอบตาม SUGGEST_SCHEMA) */
export function importSuggestPrompt(x: { businessType?: string | null; guidance?: string | null; label: string; kind: 'item' | 'expense' | 'account';
  lines: Array<{ index: number; description: string; amount: string; candidates: Array<{ code: string; name: string }> }>; codes: Array<{ code: string; name: string }> }) {
  const what = x.kind === 'account' ? 'เลขที่บัญชี (ผังบัญชีของกิจการ)' : x.kind === 'expense' ? 'รหัสค่าใช้จ่ายอื่น' : 'รหัสสินค้า/บริการ';
  return [
    `ประเภทธุรกิจ: ${x.businessType || 'ไม่ระบุ'}`,
    `แนวทางการลงบัญชีของกิจการ (guidance): ${x.guidance?.trim() || '— ไม่มี —'}`,
    `นำเข้าเป็น: ${x.label} · ต้องเลือก${what}ให้แต่ละบรรทัด (code ในคำตอบ = รหัสนั้น)`,
    `รหัสทั้งหมดที่เลือกได้ (expense_codes): ${JSON.stringify(x.codes)}`,
    `lines: ${JSON.stringify(x.lines.map((l) => ({ index: l.index, description: l.description, amount: l.amount, candidates: l.candidates })))}`,
  ].join('\n');
}

/**
 * เดาการจับคู่โดยไม่ใช้ AI (ตั้งต้นหน้าจับคู่เอง / เมื่อไม่ได้เปิด AI): แถวหัวตาราง = แถวต้นแฟ้มที่มีข้อความ (ไม่ใช่ตัวเลข) มากที่สุด
 * คอลัมน์ = ชื่อหัวตรงกับชื่อ/ชื่ออื่นของคอลัมน์แบบฟอร์ม หรือคล้ายมาก
 */
export function guessMapping(rows: string[][], target: ImportMapTarget): ImportMapping {
  let header = -1, best = 1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const n = (rows[r] ?? []).filter((c) => { const t = cleanImportCell(c); return t && !/^[\d.,()\-/ ]+$/.test(t); }).length;
    if (n > best) { best = n; header = r; }
  }
  const all = target === 'journal' ? JOURNAL_IMPORT_COLUMNS : target === 'expense' ? EXPENSE_IMPORT_COLUMNS : IMPORT_COLUMNS;
  const names = new Map<string, string>();
  for (const c of all) for (const n of [c.th, ...c.aliases]) names.set(normHead(n), c.key);
  const columns: ImportMapping['columns'] = [];
  const used = new Set<string>();
  (header >= 0 ? rows[header]! : []).forEach((cell, i) => {
    const k = names.get(normHead(String(cell ?? '')));
    if (k && !used.has(k)) { used.add(k); columns.push({ target: k, source: i, constant: '' }); }
  });
  return { header_row: header, columns, date_order: 'dmy', year: 'auto', decimal: 'dot', group: 'column', skip_words: ['รวม', 'total'], notes: '' };
}
