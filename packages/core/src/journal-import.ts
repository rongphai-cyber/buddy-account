import { d } from './money.js';
import type { YearSystem } from './date.js';
import { importDate, importNumber, type ImportIssue } from './trade-import.js';

/**
 * นำเข้าใบสำคัญ (สมุดรายวันทุกเล่ม) จากแฟ้ม Excel/CSV (เจ้าของ 17/11/2569 "นำเข้าการบันทึกบัญชีจาก Excel ตาม Format ที่คุณกำหนดเพื่อลงบัญชีในแต่ละสมุดรายวัน")
 * 1 แถว = 1 บรรทัดบัญชี · แถวที่ "สมุด + เลขที่กลุ่ม" เดียวกัน = ใบสำคัญใบเดียวกัน (เลขที่ใบสำคัญจริงระบบออกให้)
 * ส่วนนี้: ตาราง → ใบสำคัญร่าง + ข้อผิดพลาดรายแถว (ไม่แตะฐานข้อมูล) · หารหัส/บันทึกอยู่ที่ server (ใช้ร่วมกับ MCP ภายหลัง)
 */
export type JournalImportKey = 'book' | 'group' | 'date' | 'ref' | 'description' | 'account' | 'line_description' | 'department' | 'job' | 'debit' | 'credit';
export interface JournalImportColumn { key: JournalImportKey; th: string; aliases: string[]; required?: boolean; hint: string; example: [string, string, string] }

export const JOURNAL_IMPORT_COLUMNS: JournalImportColumn[] = [
  { key: 'book', th: 'สมุด', aliases: ['สมุดรายวัน', 'รหัสสมุด', 'book', 'journal'], required: true, hint: 'ตัวนำหน้าหรือรหัสของสมุดรายวัน เช่น JV PV RV SV UV (ดูที่ บัญชี › สร้างสมุดรายวัน)', example: ['PV', 'PV', 'JV'] },
  { key: 'group', th: 'เลขที่กลุ่ม', aliases: ['กลุ่ม', 'ใบที่', 'เลขที่ใบ', 'group', 'voucher'], required: true, hint: 'แถวที่สมุดและเลขที่กลุ่มเดียวกัน = ใบสำคัญใบเดียวกัน (เลขที่ใบสำคัญจริงระบบออกให้) · บริษัทที่ตั้งให้ป้อนเลขที่เอง = ใช้เลขนี้เป็นเลขที่ใบสำคัญ', example: ['1', '1', '2'] },
  { key: 'date', th: 'วันที่', aliases: ['วันที่ใบสำคัญ', 'date'], required: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) หรือช่องวันที่ของ Excel — ต้องอยู่ในงวดที่ยังไม่ปิด', example: ['', '', ''] },
  { key: 'ref', th: 'อ้างอิง', aliases: ['เลขที่อ้างอิง', 'reference', 'ref'], hint: 'เลขที่เอกสารต้นทาง (ใบเสร็จ ใบกำกับ) ไม่เกิน 30 ตัว — อ้างอิงเดิมในสมุดเดิมที่ยังไม่ยกเลิก = นำเข้าซ้ำ ไม่รับ', example: ['INV-6901', '', 'ADJ-01'] },
  { key: 'description', th: 'คำอธิบาย', aliases: ['คำอธิบายหัว', 'คำอธิบายใบสำคัญ', 'description'], hint: 'คำอธิบายของใบสำคัญ (แถวแรกของกลุ่ม)', example: ['จ่ายค่าไฟฟ้าเดือนตุลาคม', '', 'ปรับปรุงค่าใช้จ่ายค้างจ่าย'] },
  { key: 'account', th: 'เลขที่บัญชี', aliases: ['บัญชี', 'รหัสบัญชี', 'account'], required: true, hint: 'เลขที่บัญชีย่อยในผังบัญชี (บัญชีคุมลงรายการไม่ได้)', example: ['', '', ''] },
  { key: 'line_description', th: 'คำอธิบายรายการ', aliases: ['รายละเอียด', 'คำอธิบายบรรทัด', 'linedescription'], hint: 'ว่าง = ใช้คำอธิบายของใบสำคัญ (แสดงในบัญชีแยกประเภท)', example: ['ค่าไฟฟ้าสำนักงาน', '', ''] },
  { key: 'department', th: 'แผนก', aliases: ['รหัสแผนก', 'department'], hint: 'รหัสแผนก ว่าง = ไม่ระบุ', example: ['', '', ''] },
  { key: 'job', th: 'Job', aliases: ['รหัสjob', 'โครงการ', 'project'], hint: 'รหัส Job/โครงการ ว่าง = ไม่ระบุ · Job ที่ปิดแล้วใช้ไม่ได้', example: ['', '', ''] },
  { key: 'debit', th: 'เดบิต', aliases: ['dr', 'debit'], hint: 'ตัวเลข — ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง', example: ['1500', '', '800'] },
  { key: 'credit', th: 'เครดิต', aliases: ['cr', 'credit'], hint: 'ตัวเลข — ยอดเดบิตรวม = เครดิตรวม ทุกใบ', example: ['', '1500', ''] },
];
export const MAX_JOURNAL_IMPORT_ROWS = 5000;
export const MAX_JOURNAL_IMPORT_VOUCHERS = 500;

export interface JournalImportLine { row: number; account: string; description: string | null; department: string | null; job: string | null; debit: string; credit: string }
export interface JournalImportVoucher { book: string; group: string; row: number; date: string; ref: string | null; description: string | null; lines: JournalImportLine[]; debit: string; credit: string }

const norm = (s: string) => s.replace(/[\s_\-().]/g, '').toLowerCase();

export function mapJournalImport(rows: string[][], ys: YearSystem): { vouchers: JournalImportVoucher[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const lookup = new Map<string, JournalImportKey>();
  for (const c of JOURNAL_IMPORT_COLUMNS) for (const n of [c.th, ...c.aliases]) lookup.set(norm(n), c.key);
  let headAt = -1;
  const cols = new Map<JournalImportKey, number>();
  for (let r = 0; r < Math.min(rows.length, 20) && headAt < 0; r++) {
    const hits = (rows[r] ?? []).map((x, i) => [lookup.get(norm(String(x ?? ''))), i] as const).filter((x): x is readonly [JournalImportKey, number] => !!x[0]);
    if (hits.length >= 3) { headAt = r; for (const [k, i] of hits) if (!cols.has(k)) cols.set(k, i); }
  }
  const req = JOURNAL_IMPORT_COLUMNS.filter((c) => c.required);
  if (headAt < 0) return { vouchers: [], errors: [{ row: 1, message: `ไม่พบหัวตาราง — แถวแรกต้องมีชื่อคอลัมน์ ${req.map((c) => `"${c.th}"`).join(' ')} "เดบิต" "เครดิต" (ดาวน์โหลดแฟ้มตัวอย่าง)` }] };
  const missing = [...req, ...JOURNAL_IMPORT_COLUMNS.filter((c) => c.key === 'debit' || c.key === 'credit')].filter((c) => !cols.has(c.key));
  if (missing.length) return { vouchers: [], errors: [{ row: headAt + 1, message: `ไม่มีคอลัมน์ ${missing.map((c) => `"${c.th}"`).join(', ')} — ใช้ชื่อหัวคอลัมน์ตามแฟ้มตัวอย่าง` }] };
  const cell = (r: string[], k: JournalImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(r[i] ?? '').trim(); };
  const out = new Map<string, JournalImportVoucher>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_JOURNAL_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_JOURNAL_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const before = errors.length;
    const bad = (m: string) => errors.push({ row: no, message: m });
    const book = cell(row, 'book'), group = cell(row, 'group'), account = cell(row, 'account');
    if (!book) bad('ไม่มีสมุด (เช่น JV PV RV)');
    if (!group) bad('ไม่มีเลขที่กลุ่ม — แถวของใบสำคัญใบเดียวกันใช้เลขเดียวกัน');
    if (group.length > 30) bad(`เลขที่กลุ่ม "${group}" ยาวเกิน 30 ตัว`);
    const date = importDate(cell(row, 'date'), ys);
    if (!date) bad(`วันที่ "${cell(row, 'date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    if (!account) bad('ไม่มีเลขที่บัญชี');
    const dr = importNumber(cell(row, 'debit') || '0'), cr = importNumber(cell(row, 'credit') || '0');
    if (dr === null) bad(`เดบิต "${cell(row, 'debit')}" ไม่ใช่ตัวเลข`);
    if (cr === null) bad(`เครดิต "${cell(row, 'credit')}" ไม่ใช่ตัวเลข`);
    if (dr !== null && cr !== null) {
      const D = d(dr), C = d(cr);
      if (D.isNegative() || C.isNegative()) bad('เดบิต/เครดิตต้องไม่ติดลบ — ยอดลบให้ใส่อีกด้าน');
      else if (D.gt(0) && C.gt(0)) bad('ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่งต่อแถว');
      else if (D.isZero() && C.isZero()) bad('ไม่มียอดเดบิตหรือเครดิต');
      else if (D.decimalPlaces() > 2 || C.decimalPlaces() > 2) bad('จำนวนเงินทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
    }
    const ref = cell(row, 'ref') || null, desc = cell(row, 'description') || null;
    if (ref && ref.length > 30) bad(`อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    if (desc && desc.length > 200) bad('คำอธิบายยาวเกิน 200 ตัว');
    const ldesc = cell(row, 'line_description') || null;
    if (ldesc && ldesc.length > 200) bad('คำอธิบายรายการยาวเกิน 200 ตัว');
    if (errors.length > before) continue;
    const key = `${book.toUpperCase()}|${group}`;
    let v = out.get(key);
    if (!v) {
      if (out.size >= MAX_JOURNAL_IMPORT_VOUCHERS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_JOURNAL_IMPORT_VOUCHERS} ใบสำคัญ — แบ่งเป็นหลายแฟ้ม`); break; }
      v = { book, group, row: no, date: date!, ref, description: desc, lines: [], debit: '0', credit: '0' };
      out.set(key, v);
    } else {
      // ข้อมูลหัวใบสำคัญต้องตรงกันทุกแถวของกลุ่มเดียวกัน (ช่องว่าง = ตามแถวแรก)
      const b2 = errors.length;
      const tag = `${book} กลุ่ม ${group}`;
      if (v.date !== date) bad(`${tag}: วันที่ไม่ตรงกับแถว ${v.row}`);
      if (ref && v.ref && ref !== v.ref) bad(`${tag}: อ้างอิงไม่ตรงกับแถว ${v.row}`);
      if (desc && v.description && desc !== v.description) bad(`${tag}: คำอธิบายไม่ตรงกับแถว ${v.row} (ใส่คำอธิบายเฉพาะแถวแรก หรือใช้ "คำอธิบายรายการ")`);
      if (errors.length > b2) continue;
      v.ref ??= ref; v.description ??= desc;
    }
    v.lines.push({ row: no, account, description: ldesc, department: cell(row, 'department') || null, job: cell(row, 'job') || null, debit: d(dr!).toFixed(2), credit: d(cr!).toFixed(2) });
  }
  const vouchers = [...out.values()];
  for (const v of vouchers) {
    const D = v.lines.reduce((s, l) => s.plus(l.debit), d(0)), C = v.lines.reduce((s, l) => s.plus(l.credit), d(0));
    v.debit = D.toFixed(2); v.credit = C.toFixed(2);
    if (v.lines.length < 2) errors.push({ row: v.row, message: `${v.book} กลุ่ม ${v.group}: ใบสำคัญต้องมีอย่างน้อย 2 บรรทัด` });
    else if (!D.eq(C)) errors.push({ row: v.row, message: `${v.book} กลุ่ม ${v.group}: ยอดไม่ดุล เดบิต ${D.toFixed(2)} เครดิต ${C.toFixed(2)} (ต่าง ${D.minus(C).abs().toFixed(2)})` });
  }
  if (!vouchers.length && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  errors.sort((p, q) => p.row - q.row);
  return { vouchers, errors };
}
