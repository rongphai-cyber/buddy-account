import { importDate, importNumber, type ImportIssue } from './trade-import.js';
import type { YearSystem } from './date.js';

/**
 * นำเข้าระบบเงินเดือนจาก Excel/CSV (ระยะ 3): ทะเบียนพนักงาน · ยอดประจำงวด (OT วันทำงาน โบนัส …)
 * หัวตารางจับคู่ด้วยชื่อคอลัมน์ (ไม่สนลำดับ) · ตรวจทั้งแฟ้มก่อน — ผิดแม้แถวเดียวไม่บันทึกเลย
 */
export interface EmpImportCol { key: string; th: string; aliases?: string[]; required?: 'always' | 'new'; hint: string; example: string }
export const EMP_IMPORT_COLUMNS: EmpImportCol[] = [
  { key: 'code', th: 'รหัสพนักงาน', required: 'always', hint: 'รหัสเดิม = แก้เฉพาะช่องที่กรอก · รหัสใหม่ = เพิ่มพนักงาน', example: 'E001' },
  { key: 'title', th: 'คำนำหน้า', hint: 'นาย นาง นางสาว', example: 'นาย' },
  { key: 'first_name', th: 'ชื่อ', required: 'new', hint: '', example: 'สมชาย' },
  { key: 'last_name', th: 'นามสกุล', hint: 'ต้องมีเพื่อยื่น ภ.ง.ด.1', example: 'ใจดี' },
  { key: 'first_name_en', th: 'ชื่ออังกฤษ', hint: '', example: '' },
  { key: 'last_name_en', th: 'นามสกุลอังกฤษ', hint: '', example: '' },
  { key: 'nickname', th: 'ชื่อเล่น', hint: '', example: '' },
  { key: 'tax_id', th: 'เลขบัตรประชาชน', aliases: ['เลขประจำตัวประชาชน', 'เลขประจำตัวผู้เสียภาษี'], hint: '13 หลัก (จัดรูปแบบช่องเป็นข้อความ)', example: '1101700230708' },
  { key: 'gender', th: 'เพศ', hint: 'ชาย/หญิง', example: 'ชาย' },
  { key: 'birth_date', th: 'วันเกิด', hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.)', example: '15/03/2530' },
  { key: 'nationality', th: 'สัญชาติ', hint: '', example: 'ไทย' },
  { key: 'reg_house_no', th: 'เลขที่', aliases: ['บ้านเลขที่'], hint: 'ที่อยู่ตามทะเบียนบ้าน', example: '9/9' },
  { key: 'reg_moo', th: 'หมู่ที่', aliases: ['หมู่'], hint: '', example: '' },
  { key: 'reg_village', th: 'หมู่บ้าน', hint: '', example: '' },
  { key: 'reg_building', th: 'อาคาร', hint: '', example: '' },
  { key: 'reg_soi', th: 'ซอย', hint: '', example: '' },
  { key: 'reg_road', th: 'ถนน', hint: '', example: 'ห้วยแก้ว' },
  { key: 'reg_subdistrict', th: 'ตำบล/แขวง', aliases: ['ตำบล', 'แขวง'], hint: '', example: 'สุเทพ' },
  { key: 'reg_district', th: 'อำเภอ/เขต', aliases: ['อำเภอ', 'เขต'], hint: '', example: 'เมืองเชียงใหม่' },
  { key: 'reg_province', th: 'จังหวัด', hint: '', example: 'เชียงใหม่' },
  { key: 'reg_postcode', th: 'รหัสไปรษณีย์', hint: '5 หลัก', example: '50200' },
  { key: 'current_address', th: 'ที่อยู่ปัจจุบัน', hint: 'ว่าง = ตามทะเบียนบ้าน', example: '' },
  { key: 'phone', th: 'โทรศัพท์', hint: '', example: '' },
  { key: 'email', th: 'อีเมล', hint: '', example: '' },
  { key: 'department', th: 'แผนก', aliases: ['รหัสแผนก'], hint: 'รหัสแผนก', example: '' },
  { key: 'branch', th: 'สาขา', aliases: ['รหัสสาขา'], hint: 'รหัสสาขา (ว่าง = สำนักงานใหญ่)', example: '' },
  { key: 'position', th: 'ตำแหน่ง', hint: '', example: 'พนักงานบัญชี' },
  { key: 'employee_type', th: 'ประเภทพนักงาน', hint: 'ประจำ รายวัน ทดลองงาน …', example: 'ประจำ' },
  { key: 'hire_date', th: 'วันเริ่มงาน', required: 'new', hint: 'วว/ดด/ปปปป', example: '01/01/2569' },
  { key: 'wage_type', th: 'วิธีคิดค่าจ้าง', aliases: ['ประเภทค่าจ้าง'], hint: 'รายเดือน/รายวัน/รายชั่วโมง', example: 'รายเดือน' },
  { key: 'rate', th: 'อัตราค่าจ้าง', aliases: ['เงินเดือน', 'ค่าจ้าง'], required: 'new', hint: 'พนักงานใหม่เท่านั้น (คนเดิมปรับที่ประวัติค่าจ้าง)', example: '25000' },
  { key: 'pay_method', th: 'รับเงิน', hint: 'โอน/เงินสด', example: 'โอน' },
  { key: 'bank', th: 'ธนาคาร', aliases: ['รหัสธนาคาร'], hint: 'รหัสธนาคารในตารางข้อมูล', example: '' },
  { key: 'bank_account_no', th: 'เลขบัญชี', aliases: ['เลขที่บัญชี'], hint: '10–15 หลัก (จัดรูปแบบเป็นข้อความ)', example: '' },
  { key: 'bank_account_name', th: 'ชื่อบัญชี', hint: '', example: '' },
  { key: 'sso_insured', th: 'ประกันสังคม', hint: 'ใช่/ไม่', example: 'ใช่' },
  { key: 'tax_bearer', th: 'ผู้รับภาระภาษี', hint: 'หัก ณ ที่จ่าย / ออกให้ครั้งเดียว / ออกให้ตลอดไป / ไม่หัก', example: 'หัก ณ ที่จ่าย' },
];
const norm = (s: string) => s.replace(/[\s_\-().*]/g, '').toLowerCase();
const WAGE: Record<string, string> = { รายเดือน: 'M', รายวัน: 'D', รายชั่วโมง: 'H', m: 'M', d: 'D', h: 'H' };
const BEARER: Record<string, string> = { หักณที่จ่าย: 'W', ออกให้ครั้งเดียว: 'O', ออกให้ตลอดไป: 'F', ไม่หัก: 'N', w: 'W', o: 'O', f: 'F', n: 'N' };
const YES = new Set(['ใช่', 'y', 'yes', 'true', '1', 'มี', '✓']), NO = new Set(['ไม่', 'ไม่ใช่', 'n', 'no', 'false', '0', 'ไม่มี']);

/** หาแถวหัวตาราง (แถวแรกที่ตรงชื่อคอลัมน์อย่างน้อย 2 ช่อง) → ตำแหน่งคอลัมน์ */
function header<T extends { key: string; th: string; aliases?: string[] }>(rows: string[][], cols: T[]) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map = new Map<string, number>();
    rows[r]!.forEach((h, i) => { const n = norm(h); const c = cols.find((x) => norm(x.th) === n || x.aliases?.some((a) => norm(a) === n)); if (c && !map.has(c.key)) map.set(c.key, i); });
    if (map.size >= 2) return { at: r, map };
  }
  return null;
}

export interface EmpImportRow { row: number; code: string; values: Record<string, string | boolean | null> }
/** แถวพนักงาน → ค่าที่กรอก (ช่องว่าง = ไม่แก้) · ตรวจรูปแบบ วันที่ ตัวเลข ตัวเลือก */
export function mapEmployeeImport(rows: string[][], ys: YearSystem): { rows: EmpImportRow[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const h = header(rows, EMP_IMPORT_COLUMNS);
  if (!h || !h.map.has('code')) return { rows: [], errors: [{ row: 1, message: 'ไม่พบหัวตาราง — ต้องมีคอลัมน์ "รหัสพนักงาน" (ดาวน์โหลดแบบฟอร์มตัวอย่าง)' }] };
  const out: EmpImportRow[] = [];
  const seen = new Map<string, number>();
  for (let r = h.at + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (k: string) => { const i = h.map.get(k); return i === undefined ? '' : (cells[i] ?? '').trim(); };
    if (EMP_IMPORT_COLUMNS.every((c) => !get(c.key))) continue;
    const line = r + 1;
    const err = (m: string) => errors.push({ row: line, message: m });
    const code = get('code').toUpperCase();
    if (!code) { err('ไม่มีรหัสพนักงาน'); continue; }
    if (seen.has(code)) { err(`รหัส ${code} ซ้ำกับแถวที่ ${seen.get(code)}`); continue; }
    seen.set(code, line);
    const v: Record<string, string | boolean | null> = {};
    for (const c of EMP_IMPORT_COLUMNS) {
      const raw = get(c.key);
      if (!raw || c.key === 'code') continue;
      if (c.key === 'birth_date' || c.key === 'hire_date') { const iso = importDate(raw, ys); if (!iso) err(`${c.th} "${raw}" ไม่ใช่วันที่ — ใช้ วว/ดด/ปปปป`); else v[c.key] = iso; }
      else if (c.key === 'rate') { const n = importNumber(raw); if (n === null || Number(n) <= 0) err(`อัตราค่าจ้าง "${raw}" ต้องเป็นตัวเลขมากกว่า 0`); else v.rate = n; }
      else if (c.key === 'wage_type') { const x = WAGE[norm(raw)]; if (!x) err(`วิธีคิดค่าจ้าง "${raw}" — ใช้ รายเดือน/รายวัน/รายชั่วโมง`); else v.wage_type = x; }
      else if (c.key === 'tax_bearer') { const x = BEARER[norm(raw)]; if (!x) err(`ผู้รับภาระภาษี "${raw}" — ใช้ หัก ณ ที่จ่าย/ออกให้ครั้งเดียว/ออกให้ตลอดไป/ไม่หัก`); else v.tax_bearer = x; }
      else if (c.key === 'gender') { const x = /^(ชาย|m|male)$/i.test(raw) ? 'M' : /^(หญิง|f|female)$/i.test(raw) ? 'F' : null; if (!x) err(`เพศ "${raw}" — ใช้ ชาย/หญิง`); else v.gender = x; }
      else if (c.key === 'pay_method') { const x = /^(โอน|b|bank)/i.test(raw) ? 'B' : /^(เงินสด|c|cash)/i.test(raw) ? 'C' : null; if (!x) err(`รับเงิน "${raw}" — ใช้ โอน/เงินสด`); else v.pay_method = x; }
      else if (c.key === 'sso_insured') { const k = raw.toLowerCase(); if (YES.has(k)) v.sso_insured = true; else if (NO.has(k)) v.sso_insured = false; else err(`ประกันสังคม "${raw}" — ใช้ ใช่/ไม่`); }
      else if (c.key === 'tax_id' || c.key === 'bank_account_no' || c.key === 'reg_postcode') v[c.key] = raw.replace(/[\s-]/g, '').replace(/\.0+$/, '');
      else v[c.key] = raw;
    }
    out.push({ row: line, code, values: v });
  }
  if (!out.length && !errors.length) errors.push({ row: h.at + 2, message: 'ไม่มีข้อมูลพนักงานในแฟ้ม' });
  return { rows: out, errors };
}

/** นำเข้ายอดประจำงวด: แถว = พนักงาน · คอลัมน์ "รหัส ชื่อรายการ" (จับคู่ด้วยคำแรก = รหัสรายการ) */
export interface RunImportItem { code: string; calc: string }
export interface RunImportRow { row: number; code: string; work_days: string | null; work_hours: string | null; lines: Array<{ item_code: string; qty: string | null; amount: string | null }> }
export function mapRunImport(rows: string[][], items: RunImportItem[]): { rows: RunImportRow[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const fixed = [{ key: 'code', th: 'รหัสพนักงาน' }, { key: 'work_days', th: 'วันทำงาน' }, { key: 'work_hours', th: 'ชั่วโมงทำงาน' }, { key: 'name', th: 'ชื่อ' }];
  let at = -1, map = new Map<string, number>();
  for (let r = 0; r < Math.min(rows.length, 15) && at < 0; r++) {
    const m = new Map<string, number>();
    rows[r]!.forEach((h, i) => {
      const f = fixed.find((x) => norm(x.th) === norm(h));
      if (f) { if (!m.has(f.key)) m.set(f.key, i); return; }
      const code = h.trim().split(/\s+/)[0]?.toUpperCase();
      if (code && items.some((it) => it.code.toUpperCase() === code)) m.set(`item:${code}`, i);
    });
    if (m.has('code')) { at = r; map = m; }
  }
  if (at < 0) return { rows: [], errors: [{ row: 1, message: 'ไม่พบหัวตาราง — ต้องมีคอลัมน์ "รหัสพนักงาน" (ดาวน์โหลดแบบฟอร์มจากรอบเงินเดือนนี้)' }] };
  const unknown = rows[at]!.map((h, i) => [h, i] as const).filter(([h, i]) => h.trim() && ![...map.values()].includes(i));
  for (const [h] of unknown) errors.push({ row: at + 1, message: `คอลัมน์ "${h}" ไม่ตรงกับรายการเงินได้/เงินหักที่ป้อนได้ — ขึ้นต้นด้วยรหัสรายการ เช่น "IN002 ค่าล่วงเวลา"` });
  const out: RunImportRow[] = [];
  const seen = new Set<string>();
  for (let r = at + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (k: string) => { const i = map.get(k); return i === undefined ? '' : (cells[i] ?? '').trim(); };
    const code = get('code').toUpperCase();
    if (!code) { if (cells.some((c) => c.trim())) errors.push({ row: r + 1, message: 'ไม่มีรหัสพนักงาน' }); continue; }
    if (seen.has(code)) { errors.push({ row: r + 1, message: `รหัส ${code} ซ้ำ` }); continue; }
    seen.add(code);
    const num = (k: string, label: string) => { const raw = get(k); if (!raw) return null; const n = importNumber(raw); if (n === null || Number(n) < 0) { errors.push({ row: r + 1, message: `${label} "${raw}" ต้องเป็นตัวเลขไม่ติดลบ` }); return null; } return n; };
    const line: RunImportRow = { row: r + 1, code, work_days: num('work_days', 'วันทำงาน'), work_hours: num('work_hours', 'ชั่วโมงทำงาน'), lines: [] };
    for (const it of items) {
      const v = num(`item:${it.code.toUpperCase()}`, it.code);
      if (v === null || Number(v) === 0) continue;
      const qty = it.calc === 'HOURS' || it.calc === 'DAYS' || it.calc === 'MINUTES';
      line.lines.push({ item_code: it.code, qty: qty ? v : null, amount: qty ? null : v });
    }
    out.push(line);
  }
  return { rows: out, errors };
}
