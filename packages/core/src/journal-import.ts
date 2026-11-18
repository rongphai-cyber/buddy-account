import { d } from './money.js';
import type { YearSystem } from './date.js';
import { importDate, importNumber, type ImportIssue } from './trade-import.js';
import { checkTaxId } from './taxid.js';

/**
 * นำเข้าใบสำคัญ (สมุดรายวันทุกเล่ม) จากแฟ้ม Excel/CSV (เจ้าของ 17/11/2569 "นำเข้าการบันทึกบัญชีจาก Excel ตาม Format ที่คุณกำหนดเพื่อลงบัญชีในแต่ละสมุดรายวัน")
 * 1 แถว = 1 บรรทัดบัญชี · แถวที่ "สมุด + เลขที่กลุ่ม" เดียวกัน = ใบสำคัญใบเดียวกัน (เลขที่ใบสำคัญ: ว่าง = ระบบออกให้ · ใส่เอง = ต้องขึ้นต้นตามสมุด 18/11/2569)
 * ส่วนนี้: ตาราง → ใบสำคัญร่าง + ข้อผิดพลาดรายแถว (ไม่แตะฐานข้อมูล) · หารหัส/บันทึกอยู่ที่ server (ใช้ร่วมกับ MCP ภายหลัง)
 */
export type JournalImportKey = 'book' | 'group' | 'voucher_no' | 'date' | 'ref' | 'description' | 'account' | 'line_description' | 'department' | 'job' | 'debit' | 'credit'
  | 'tax' | 'tax_no' | 'tax_date' | 'tax_month' | 'party' | 'party_tax_id' | 'party_branch' | 'tax_base' | 'tax_rate' | 'income_type';
export interface JournalImportColumn { key: JournalImportKey; th: string; aliases: string[]; required?: boolean; hint: string; example: [string, string, string] }

export const JOURNAL_IMPORT_COLUMNS: JournalImportColumn[] = [
  { key: 'book', th: 'สมุด', aliases: ['สมุดรายวัน', 'รหัสสมุด', 'book', 'journal'], required: true, hint: 'ตัวนำหน้าหรือรหัสของสมุดรายวัน เช่น JV PV RV SV UV (ดูที่ บัญชี › สร้างสมุดรายวัน)', example: ['PV', 'PV', 'JV'] },
  { key: 'group', th: 'เลขที่กลุ่ม', aliases: ['กลุ่ม', 'ใบที่', 'เลขที่ใบ', 'group', 'voucher'], required: true, hint: 'แถวที่สมุดและเลขที่กลุ่มเดียวกัน = ใบสำคัญใบเดียวกัน · ว่างได้ถ้าใส่ "เลขที่ใบสำคัญ" ทุกแถว (ใช้เลขที่ใบสำคัญจัดกลุ่ม)', example: ['1', '1', '2'] },
  // เลขที่ใบสำคัญที่ผู้ใช้กำหนดเอง (เจ้าของ 18/11/2569 "เพิ่มเลขที่เอกสารที่สามารถสร้างเองได้ แต่รหัสจะถูกบังคับตามสมุดรายวัน เช่น PV ต้องขึ้นต้นด้วย PVxxxxxxx")
  { key: 'voucher_no', th: 'เลขที่ใบสำคัญ', aliases: ['เลขที่เอกสาร', 'voucherno', 'docno', 'documentno'], hint: 'ว่าง = ระบบออกเลขให้ตามสมุด · ใส่เอง = ต้องขึ้นต้นด้วยตัวนำหน้าของสมุด (สมุด PV → PV…) ไม่เกิน 30 ตัว ไม่มีช่องว่าง ห้ามซ้ำกับใบสำคัญที่มีอยู่ (ใบที่ยกเลิกแล้วยังจองเลขไว้จนกว่าจะลบ) · ใส่แถวแรกของกลุ่มก็พอ (ถ้าไม่ใส่เลขที่กลุ่ม ต้องใส่ทุกแถว)', example: ['', '', ''] },
  { key: 'date', th: 'วันที่', aliases: ['วันที่ใบสำคัญ', 'date'], required: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) หรือช่องวันที่ของ Excel — ต้องอยู่ในงวดที่ยังไม่ปิด', example: ['', '', ''] },
  { key: 'ref', th: 'อ้างอิง', aliases: ['เลขที่อ้างอิง', 'reference', 'ref'], hint: 'เลขที่เอกสารต้นทาง (ใบเสร็จ ใบกำกับ) ไม่เกิน 30 ตัว — อ้างอิงเดิมในสมุดเดิมที่ยังไม่ยกเลิก = นำเข้าซ้ำ ไม่รับ', example: ['INV-6901', '', 'ADJ-01'] },
  { key: 'description', th: 'คำอธิบาย', aliases: ['คำอธิบายหัว', 'คำอธิบายใบสำคัญ', 'description'], hint: 'คำอธิบายของใบสำคัญ (แถวแรกของกลุ่ม)', example: ['จ่ายค่าไฟฟ้าเดือนตุลาคม', '', 'ปรับปรุงค่าใช้จ่ายค้างจ่าย'] },
  { key: 'account', th: 'เลขที่บัญชี', aliases: ['บัญชี', 'รหัสบัญชี', 'account'], required: true, hint: 'เลขที่บัญชีย่อยในผังบัญชี (บัญชีคุมลงรายการไม่ได้)', example: ['', '', ''] },
  { key: 'line_description', th: 'คำอธิบายรายการ', aliases: ['รายละเอียด', 'คำอธิบายบรรทัด', 'linedescription'], hint: 'ว่าง = ใช้คำอธิบายของใบสำคัญ (แสดงในบัญชีแยกประเภท)', example: ['ค่าไฟฟ้าสำนักงาน', '', ''] },
  { key: 'department', th: 'แผนก', aliases: ['รหัสแผนก', 'department'], hint: 'รหัสแผนก ว่าง = ไม่ระบุ', example: ['', '', ''] },
  { key: 'job', th: 'Job', aliases: ['รหัสjob', 'โครงการ', 'project'], hint: 'รหัส Job/โครงการ ว่าง = ไม่ระบุ · Job ที่ปิดแล้วใช้ไม่ได้', example: ['', '', ''] },
  { key: 'debit', th: 'เดบิต', aliases: ['dr', 'debit'], hint: 'ตัวเลข — ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง', example: ['1500', '', '800'] },
  { key: 'credit', th: 'เครดิต', aliases: ['cr', 'credit'], hint: 'ตัวเลข — ยอดเดบิตรวม = เครดิตรวม ทุกใบ', example: ['', '1500', ''] },
  // ภาษี (เจ้าของเลือก ก 18/11/2569): ใส่ในแถวของบัญชีภาษี — ยอดเดบิต/เครดิตของแถว = ยอดภาษี ระบบเติมแฟ้มภาษีซื้อ/ขาย/หัก ณ ที่จ่ายผูกกับใบสำคัญ
  { key: 'tax', th: 'ภาษี', aliases: ['ประเภทภาษี', 'tax', 'taxtype'], hint: 'ใส่เฉพาะแถวของบัญชีภาษี: ภาษีซื้อ (เดบิต) · ภาษีขาย (เครดิต) · ภงด3 / ภงด53 (ภาษีหัก ณ ที่จ่ายค้างจ่าย เครดิต) — ยอดเงินของแถว = ยอดภาษี ระบบเติมแฟ้มภาษีให้ · แถวอื่นเว้นว่าง', example: ['', '', ''] },
  { key: 'tax_no', th: 'เลขที่ใบกำกับ', aliases: ['เลขที่ใบกำกับภาษี', 'เลขที่หนังสือรับรอง', 'taxinvoiceno', 'taxno'], hint: 'ภาษีซื้อ/ขาย: เลขที่ใบกำกับภาษี (ต้องมี) · ภงด3/53: เลขที่หนังสือรับรอง (ว่างได้)', example: ['', '', ''] },
  { key: 'tax_date', th: 'วันที่ใบกำกับ', aliases: ['วันที่ใบกำกับภาษี', 'วันที่หนังสือรับรอง', 'taxdate'], hint: 'วันที่ใบกำกับภาษี / วันที่จ่าย (หนังสือรับรอง) — ว่าง = วันที่ใบสำคัญ', example: ['', '', ''] },
  { key: 'tax_month', th: 'งวดภาษี', aliases: ['เดือนภาษี', 'ยื่นรวมในงวด', 'taxmonth'], hint: 'ภาษีซื้อ/ขาย: เดือนที่ยื่น ดด/ปปปป — ว่าง = เดือนของวันที่ใบกำกับ (ได้ใบกำกับล่าช้า ใส่เดือนถัดไปได้)', example: ['', '', ''] },
  { key: 'party', th: 'ชื่อคู่ค้า', aliases: ['ชื่อผู้ขาย', 'ชื่อผู้ซื้อ', 'ผู้ถูกหัก', 'ชื่อผู้ถูกหักภาษี', 'partyname'], hint: 'ชื่อผู้ขาย/ผู้ซื้อตามใบกำกับ · ภงด3/53: ชื่อผู้ถูกหักภาษี (ต้องมี)', example: ['', '', ''] },
  { key: 'party_tax_id', th: 'เลขผู้เสียภาษี', aliases: ['เลขประจำตัวผู้เสียภาษี', 'taxid'], hint: 'เลขประจำตัวผู้เสียภาษี 13 หลักของคู่ค้า (ระบบตรวจหลักสุดท้าย)', example: ['', '', ''] },
  { key: 'party_branch', th: 'สาขาคู่ค้า', aliases: ['สาขาผู้ขาย', 'สาขาที่', 'taxbranch'], hint: 'สาขาตามใบกำกับ 5 หลัก — 00000 หรือ "สำนักงานใหญ่" · ว่าง = ไม่ระบุ', example: ['', '', ''] },
  { key: 'tax_base', th: 'ฐานภาษี', aliases: ['มูลค่าก่อนภาษี', 'ยอดก่อนภาษี', 'จำนวนเงินที่จ่าย', 'base'], hint: 'ภาษีซื้อ/ขาย: มูลค่าก่อนภาษี (ว่าง = ภาษี ÷ 7%) · ภงด3/53: จำนวนเงินที่จ่าย (ต้องมี)', example: ['', '', ''] },
  { key: 'tax_rate', th: 'อัตราภาษี', aliases: ['อัตรา', 'rate'], hint: 'ภงด3/53: อัตราที่หัก % — ว่าง = ภาษี ÷ จำนวนเงินที่จ่าย', example: ['', '', ''] },
  { key: 'income_type', th: 'ประเภทเงินได้', aliases: ['incometype'], hint: 'ภงด3/53: เช่น ค่าบริการ ค่าเช่า ค่าขนส่ง ค่าโฆษณา — ว่าง = ค่าบริการ', example: ['', '', ''] },
];
const TAX_DETAIL_KEYS: JournalImportKey[] = ['tax_no', 'tax_date', 'tax_month', 'party', 'party_tax_id', 'party_branch', 'tax_base', 'tax_rate', 'income_type'];
export type JournalImportTaxKind = 'P' | 'S' | 'S03' | 'S53';
export const JOURNAL_IMPORT_TAX_LABEL: Record<JournalImportTaxKind, string> = { P: 'ภาษีซื้อ', S: 'ภาษีขาย', S03: 'ภ.ง.ด.3', S53: 'ภ.ง.ด.53' };
const TAX_KIND: Record<string, JournalImportTaxKind> = {
  ซื้อ: 'P', ภาษีซื้อ: 'P', p: 'P', vatin: 'P', in: 'P', input: 'P',
  ขาย: 'S', ภาษีขาย: 'S', s: 'S', vatout: 'S', out: 'S', output: 'S',
  ภงด3: 'S03', '3': 'S03', pnd3: 'S03', s03: 'S03',
  ภงด53: 'S53', '53': 'S53', pnd53: 'S53', s53: 'S53',
};
/** รายละเอียดภาษีของแถว · amount = ยอดเงินของแถว (ยอดภาษี) · date/month ว่าง = ตามวันที่ใบสำคัญ */
export interface JournalImportTax {
  kind: JournalImportTaxKind; no: string | null; date: string | null; month: string | null; party: string | null; party_tax_id: string | null; party_branch: string | null;
  base: string; rate: string | null; income_type: string | null; amount: string;
}
export const MAX_JOURNAL_IMPORT_ROWS = 5000;
export const MAX_JOURNAL_IMPORT_VOUCHERS = 500;

export interface JournalImportLine { row: number; account: string; description: string | null; department: string | null; job: string | null; debit: string; credit: string; tax: JournalImportTax | null }
export interface JournalImportVoucher { book: string; group: string;
  /** เลขที่ใบสำคัญที่กำหนดเอง (ตัวพิมพ์ใหญ่) · null = ระบบออกเลขให้ · server ตรวจตัวนำหน้าของสมุดและซ้ำในบริษัท */
  voucher_no: string | null; row: number; date: string; ref: string | null; description: string | null; lines: JournalImportLine[]; debit: string; credit: string;
  /** มีแถวผิด/ไม่ดุล — แจ้งใน errors แล้ว ไม่ต้องลองบันทึก */
  invalid?: boolean }

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
  const badGroups = new Set<string>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_JOURNAL_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_JOURNAL_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const before = errors.length;
    const bad = (m: string) => errors.push({ row: no, message: m });
    const vno = cell(row, 'voucher_no').toUpperCase() || null;
    const book = cell(row, 'book'), group = cell(row, 'group') || vno || '', account = cell(row, 'account');
    if (!book) bad('ไม่มีสมุด (เช่น JV PV RV)');
    if (!group) bad('ไม่มีเลขที่กลุ่ม — แถวของใบสำคัญใบเดียวกันใช้เลขเดียวกัน (หรือใส่ "เลขที่ใบสำคัญ" ทุกแถวของใบนั้น)');
    if (group.length > 30) bad(`เลขที่กลุ่ม "${group}" ยาวเกิน 30 ตัว`);
    if (vno && vno.length > 30) bad(`เลขที่ใบสำคัญ "${vno}" ยาวเกิน 30 ตัว`);
    else if (vno && /\s/.test(vno)) bad(`เลขที่ใบสำคัญ "${vno}" มีช่องว่าง — ลบช่องว่างออก`);
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
    const key = `${book.toUpperCase()}|${group}`;
    // ใบที่มีแถวผิด: ไม่ต้องแจ้ง "ไม่ดุล" ซ้ำ (แถวที่ผิดไม่ได้นับยอด)
    if (errors.length > before) { if (book && group) badGroups.add(key); continue; }
    const tax = taxOfRow((k) => cell(row, k), d(dr!), d(cr!), ys, bad);
    if (errors.length > before) { badGroups.add(key); continue; }
    let v = out.get(key);
    if (!v) {
      if (out.size >= MAX_JOURNAL_IMPORT_VOUCHERS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_JOURNAL_IMPORT_VOUCHERS} ใบสำคัญ — แบ่งเป็นหลายแฟ้ม`); break; }
      v = { book, group, voucher_no: vno, row: no, date: date!, ref, description: desc, lines: [], debit: '0', credit: '0' };
      out.set(key, v);
    } else {
      // ข้อมูลหัวใบสำคัญต้องตรงกันทุกแถวของกลุ่มเดียวกัน (ช่องว่าง = ตามแถวแรก)
      const b2 = errors.length;
      const tag = `${book} กลุ่ม ${group}`;
      if (v.date !== date) bad(`${tag}: วันที่ไม่ตรงกับแถว ${v.row}`);
      if (ref && v.ref && ref !== v.ref) bad(`${tag}: อ้างอิงไม่ตรงกับแถว ${v.row}`);
      if (desc && v.description && desc !== v.description) bad(`${tag}: คำอธิบายไม่ตรงกับแถว ${v.row} (ใส่คำอธิบายเฉพาะแถวแรก หรือใช้ "คำอธิบายรายการ")`);
      if (vno && v.voucher_no && vno !== v.voucher_no) bad(`${tag}: เลขที่ใบสำคัญ ${vno} ไม่ตรงกับแถว ${v.row} (${v.voucher_no}) — ใบสำคัญใบเดียวใช้เลขเดียว`);
      if (errors.length > b2) { badGroups.add(key); continue; }
      v.ref ??= ref; v.description ??= desc; v.voucher_no ??= vno;
    }
    v.lines.push({ row: no, account, description: ldesc, department: cell(row, 'department') || null, job: cell(row, 'job') || null, debit: d(dr!).toFixed(2), credit: d(cr!).toFixed(2), tax });
  }
  const vouchers = [...out.values()];
  // เลขที่ใบสำคัญซ้ำกับกลุ่มอื่นในแฟ้ม (ห้ามซ้ำทั้งบริษัท ทุกสมุด — เหมือน createJournal)
  const byNo = new Map<string, JournalImportVoucher>();
  for (const v of vouchers) {
    if (!v.voucher_no) continue;
    const twin = byNo.get(v.voucher_no);
    if (!twin) { byNo.set(v.voucher_no, v); continue; }
    errors.push({ row: v.row, message: `${v.book} กลุ่ม ${v.group}: เลขที่ใบสำคัญ ${v.voucher_no} ซ้ำกับ ${twin.book} กลุ่ม ${twin.group} (แถว ${twin.row}) ในแฟ้มเดียวกัน` });
    badGroups.add(`${v.book.toUpperCase()}|${v.group}`);
  }
  for (const v of vouchers) {
    const D = v.lines.reduce((s, l) => s.plus(l.debit), d(0)), C = v.lines.reduce((s, l) => s.plus(l.credit), d(0));
    v.debit = D.toFixed(2); v.credit = C.toFixed(2);
    if (badGroups.has(`${v.book.toUpperCase()}|${v.group}`)) { v.invalid = true; continue; }
    if (v.lines.length < 2 || !D.eq(C)) v.invalid = true;
    if (v.lines.length < 2) errors.push({ row: v.row, message: `${v.book} กลุ่ม ${v.group}: ใบสำคัญต้องมีอย่างน้อย 2 บรรทัด` });
    else if (!D.eq(C)) errors.push({ row: v.row, message: `${v.book} กลุ่ม ${v.group}: ยอดไม่ดุล เดบิต ${D.toFixed(2)} เครดิต ${C.toFixed(2)} (ต่าง ${D.minus(C).abs().toFixed(2)})` });
  }
  if (!vouchers.length && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  errors.sort((p, q) => p.row - q.row);
  return { vouchers, errors };
}

/** เดือนภาษี: ดด/ปปปป · ปปปป-ดด · หรือวันที่เต็ม (เอาเดือน) → YYYY-MM */
function importMonth(v: string, ys: YearSystem): string | null {
  const t = v.trim();
  const a = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (a) return importDate(`01/${a[1]}/${a[2]}`, ys)?.slice(0, 7) ?? null;
  const b = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (b) return importDate(`${b[1]}-${b[2]!.padStart(2, '0')}-01`, ys)?.slice(0, 7) ?? null;
  return importDate(t, ys)?.slice(0, 7) ?? null;
}

function taxOfRow(cell: (k: JournalImportKey) => string, D: ReturnType<typeof d>, C: ReturnType<typeof d>, ys: YearSystem, bad: (m: string) => void): JournalImportTax | null {
  const raw = cell('tax');
  if (!raw) {
    const filled = JOURNAL_IMPORT_COLUMNS.filter((c) => TAX_DETAIL_KEYS.includes(c.key) && cell(c.key));
    if (filled.length) bad(`มี${filled.map((c) => `"${c.th}"`).join(' ')} แต่ไม่ได้ระบุคอลัมน์ "ภาษี" — ใส่ ภาษีซื้อ ภาษีขาย ภงด3 หรือ ภงด53 ในแถวของบัญชีภาษี`);
    return null;
  }
  const kind = TAX_KIND[norm(raw)];
  if (!kind) { bad(`ภาษี "${raw}" ไม่รู้จัก — ใช้ ภาษีซื้อ ภาษีขาย ภงด3 หรือ ภงด53`); return null; }
  const vat = kind === 'P' || kind === 'S';
  if (kind === 'P' && !D.gt(0)) bad('ภาษีซื้อต้องอยู่ด้านเดบิต (แถวบัญชีภาษีซื้อ) — ลดหนี้/คืนสินค้า ป้อนที่แฟ้มภาษีซื้อ');
  if (kind === 'S' && !C.gt(0)) bad('ภาษีขายต้องอยู่ด้านเครดิต (แถวบัญชีภาษีขาย)');
  if (!vat && !C.gt(0)) bad('ภาษีหัก ณ ที่จ่ายต้องอยู่ด้านเครดิต (แถวบัญชีภาษีหัก ณ ที่จ่ายค้างจ่าย)');
  const amount = D.gt(0) ? D : C;
  const no = cell('tax_no') || null;
  if (vat && !no) bad('ไม่มีเลขที่ใบกำกับภาษี');
  if (no && no.length > 30) bad(`เลขที่ใบกำกับ "${no}" ยาวเกิน 30 ตัว`);
  const dateTxt = cell('tax_date'), date = dateTxt ? importDate(dateTxt, ys) : null;
  if (dateTxt && !date) bad(`วันที่ใบกำกับ "${dateTxt}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
  const monthTxt = cell('tax_month'), month = monthTxt ? importMonth(monthTxt, ys) : null;
  if (monthTxt && !month) bad(`งวดภาษี "${monthTxt}" ไม่ถูกต้อง — ใช้ ดด/ปปปป เช่น 11/2569`);
  if (monthTxt && !vat) bad('งวดภาษีใช้กับภาษีซื้อ/ขายเท่านั้น — ภงด3/53 ยื่นตามเดือนของวันที่จ่าย');
  const party = cell('party') || null;
  if (!vat && !party) bad('ไม่มีชื่อผู้ถูกหักภาษี (คอลัมน์ "ชื่อคู่ค้า")');
  if (party && party.length > 200) bad('ชื่อคู่ค้ายาวเกิน 200 ตัว');
  const tid = cell('party_tax_id').replace(/[\s-]/g, '') || null;
  if (tid) { const c = checkTaxId(tid); if (!c.ok) bad(`เลขผู้เสียภาษี ${tid}: ${c.error}`); }
  let br = cell('party_branch') || null;
  if (br && /สำนักงานใหญ่|^ho$/i.test(br)) br = '00000';
  if (br && !/^\d{1,5}$/.test(br)) bad(`สาขาคู่ค้า "${br}" ต้องเป็นตัวเลข 5 หลัก (00000 = สำนักงานใหญ่)`);
  else if (br) br = br.padStart(5, '0');
  const baseTxt = cell('tax_base'), baseN = baseTxt ? importNumber(baseTxt) : null;
  if (baseTxt && baseN === null) bad(`ฐานภาษี "${baseTxt}" ไม่ใช่ตัวเลข`);
  if (!vat && !baseTxt) bad('ไม่มีจำนวนเงินที่จ่าย (คอลัมน์ "ฐานภาษี")');
  const base = baseN !== null ? d(baseN) : vat ? amount.div('0.07').toDecimalPlaces(2) : d(0);
  if (baseN !== null && (!base.gt(0) || base.decimalPlaces() > 2)) bad('ฐานภาษีต้องมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง');
  const rateTxt = cell('tax_rate'), rateN = rateTxt ? importNumber(rateTxt.replace(/%$/, '')) : null;
  if (rateTxt && (rateN === null || d(rateN).lt(0) || d(rateN).gt(100))) bad(`อัตราภาษี "${rateTxt}" ต้องเป็นตัวเลข 0–100`);
  const rate = vat ? null : rateN !== null ? d(rateN).toFixed(2) : base.gt(0) ? amount.div(base).times(100).toDecimalPlaces(2).toFixed(2) : null;
  const income = vat ? null : cell('income_type') || 'ค่าบริการ';
  if (income && income.length > 60) bad('ประเภทเงินได้ยาวเกิน 60 ตัว');
  return { kind, no, date, month, party, party_tax_id: tid, party_branch: br, base: base.toFixed(2), rate, income_type: income, amount: amount.toFixed(2) };
}
