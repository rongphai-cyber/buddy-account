import { parseDateInput, type YearSystem } from './date.js';
import { checkTaxId } from './taxid.js';
import { CASH_KINDS, TRADE_KINDS } from './doc-calc.js';
import { d } from './money.js';

/** ชนิดเอกสารที่นำเข้าจาก Excel ได้: ขาย/ซื้อที่ลงบัญชี + บันทึกค่าใช้จ่ายอื่น ๆ (HANDOFF 167) + ใบเสนอราคา/ใบสั่งขาย/ใบสั่งซื้อ (HANDOFF 171 — ไม่ลงบัญชี) — ปุ่ม "นำเข้า Excel" บนหน้าเอกสารเหล่านี้ */
export interface ImportDocKind { path: string; cls: string; module: 'AR' | 'AP'; menu: string; party: 'customer' | 'supplier'; label: string; route: string; cash?: boolean }
export const IMPORT_DOC_KINDS: ImportDocKind[] = [
  ...TRADE_KINDS.map(({ path, cls, module, menu, party, label, route }) => ({ path, cls, module, menu, party, label, route })),
  // เอกสารรับ/จ่ายเงิน: ค่าใช้จ่ายอื่น (HANDOFF 167) · มัดจำรับ/จ่าย รายได้อื่น (HANDOFF 171)
  ...CASH_KINDS.map(({ path, cls, module, menu, party, label, route }) => ({ path, cls, module, menu, party, label, route, cash: true })),
];
export const importPathOf = (cls: string) => IMPORT_DOC_KINDS.find((k) => k.cls === cls)?.path ?? null;
/** ชนิดเอกสารของหน้านำเข้า (ตามเส้นทาง) — ใช้เลือกคอลัมน์ของแบบฟอร์ม/การจับคู่ (HANDOFF 169) */
export function importKindOf(path: string): (ImportKindLike & { label: string }) | null {
  const t = TRADE_KINDS.find((k) => k.path === path);
  if (t) return t;
  const c = CASH_KINDS.find((k) => k.path === path);
  return c ? { cls: c.cls, module: c.module, party: c.party, cash: true, label: c.label } : null;
}

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * แฟ้มหนึ่งแถว = สินค้าหนึ่งบรรทัด · แถวที่ "เลขที่อ้างอิง" เดียวกันรวมเป็นเอกสารเดียว (ตามลำดับในแฟ้ม)
 * ส่วนนี้อ่านตาราง (xlsx/csv ที่คลายแล้ว) → เอกสารร่าง + ข้อผิดพลาดรายแถว · การหารหัสและบันทึกอยู่ที่เซิร์ฟเวอร์
 */
/** ชนิดเอกสารที่ใช้เลือกคอลัมน์ของแบบฟอร์ม (ขาย/ซื้อ/ค่าใช้จ่ายอื่น) */
export interface ImportKindLike { cls: string; module: 'AR' | 'AP'; party: 'customer' | 'supplier'; payments?: boolean; refInvoice?: boolean; cash?: boolean; order?: 'SO' | 'PO' }
/** ต้องมี / ต้องมีถ้า… / ไม่บังคับ (ค่าเริ่มต้น = …) — HANDOFF 169 (ต้องมี = ช่องที่หน้าจอบันทึกไม่ได้ถ้าไม่มี) */
export type ImportNeed = 'req' | 'cond' | 'opt';
export interface ImportColumn {
  key: ImportKey; th: string; aliases: string[]; required?: boolean; hint: string; example: [string, string];
  /** คอลัมน์ที่แทนกันได้ (รหัสว่างได้ถ้ามีชื่อ — เพิ่มข้อมูลหลักใหม่ HANDOFF 167) */
  alt?: ImportKey;
  /** ใช้เฉพาะเมื่อเพิ่มลูกค้า/ผู้จำหน่าย/สินค้าใหม่ */
  forNew?: boolean;
  need: ImportNeed;
  /** need = cond: เงื่อนไข (ต่อท้าย "ต้องมีถ้า") · need = opt: ค่าเริ่มต้นเมื่อเว้นว่าง */
  when?: string; dflt?: string;
  /** มีในหน้าจอของเอกสารชนิดนี้ (ไม่ระบุ = ทุกชนิด) */
  for?: (k: ImportKindLike) => boolean;
  /** ชื่อหัวคอลัมน์ตามชนิดเอกสาร (ชื่ออื่นยังอ่านได้จาก aliases) */
  thFor?: (k: ImportKindLike) => string;
  /** ช่องของหัวเอกสาร (แถวต่อมาเว้นว่างได้ — ตามแถวแรก) */
  head?: boolean;
  /** ชื่ออื่นเฉพาะชนิดเอกสาร (เช่น "เลขที่ใบกำกับ" = เลขที่เอกสารของเอกสารขาย · เลขที่ใบกำกับผู้จำหน่ายของเอกสารซื้อ) */
  aliasFor?: (k: ImportKindLike) => string[];
  /** ช่องตรวจยอดจากโปรแกรมเดิม (ไม่ใช่ช่องของหน้าจอ — ไม่อยู่ในแผ่นนำเข้าของแบบฟอร์ม · อ่านได้/จับคู่ได้ · HANDOFF 170) */
  check?: boolean;
}
export type ImportKey = 'ref' | 'doc_no' | 'vat_amount' | 'net_total' | 'date' | 'party' | 'party_name' | 'party_branch' | 'ship_to' | 'ref_no' | 'ref_date' | 'delivery_date' | 'ref_invoice' | 'credit_days' | 'department' | 'project' | 'salesperson' | 'sales_area'
  | 'ship_via' | 'vat_basis' | 'bill_discount' | 'remark' | 'pay_method' | 'pay_ref' | 'wht_amount' | 'wht_rate' | 'wht_income' | 'wht_form'
  | 'item' | 'item_name' | 'description' | 'warehouse' | 'qty' | 'unit' | 'price' | 'discount' | 'free' | 'line_job' | 'vat_code' | 'return'
  | 'party_tax_id' | 'party_address' | 'party_phone' | 'item_kind';

/** ข้อความในช่อง "จำเป็น" ของแผ่นคำอธิบาย/หน้าจอ — ถ้อยคำเดียวทุกแบบฟอร์ม */
export function importNeedLabel(c: Pick<ImportColumn, 'need' | 'when' | 'dflt' | 'forNew'>): string {
  if (c.need === 'req') return 'ต้องมี';
  if (c.need === 'cond') return `ต้องมีถ้า${c.when ?? ''}`;
  return c.dflt ? `ไม่บังคับ (${c.dflt})` : c.forNew ? 'ไม่บังคับ (ใช้เมื่อเพิ่มรายใหม่)' : 'ไม่บังคับ';
}
const isAR = (k: ImportKindLike) => k.module === 'AR';
const pays = (k: ImportKindLike) => !!k.payments || !!k.cash;
const who = (k: ImportKindLike) => (k.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย');

/** คอลัมน์ข้อมูลหลักใหม่ (ลูกค้า/ผู้จำหน่าย) — ใช้ร่วมกับแบบนำเข้าค่าใช้จ่ายอื่น */
const PARTY_NEW_COLS = {
  party_name: { key: 'party_name', th: 'ชื่อคู่ค้า', aliases: ['ชื่อลูกค้า', 'ชื่อผู้จำหน่าย', 'ชื่อผู้ขาย'], forNew: true, need: 'cond', when: 'ไม่ใส่รหัส', head: true, hint: 'ชื่อลูกค้า/ผู้จำหน่าย — ใช้เมื่อเพิ่มรายใหม่ หรือหารายเดิมเมื่อไม่ใส่รหัส', example: ['ร้านตัวอย่าง', 'ร้านตัวอย่าง'] },
  party_tax_id: { key: 'party_tax_id', th: 'เลขผู้เสียภาษี', aliases: ['เลขประจำตัวผู้เสียภาษี', 'เลขผู้เสียภาษีอากร', 'taxid'], forNew: true, need: 'opt', head: true, hint: 'รายใหม่: เลข 13 หลัก (ตรวจหลักตรวจสอบ) · ไม่ใส่รหัส = หารายเดิมจากเลขนี้ + สาขา', example: ['', ''] },
  party_branch: { key: 'party_branch', th: 'สาขา', aliases: ['เลขที่สาขา', 'สาขาที่', 'branch', 'Bill to', 'Bill to (สาขา)', 'Bill to (สาขาลูกค้า)', 'สาขาลูกค้า', 'สาขาผู้ขาย', 'สาขาผู้จำหน่าย'], need: 'opt', dflt: 'ค่าเริ่มต้น = สาขาตามแฟ้ม (สำนักงานใหญ่ 00000)', head: true,
    thFor: (k: ImportKindLike) => (k.party === 'customer' ? 'Bill to (สาขาลูกค้า)' : 'สาขาผู้ขาย'), hint: 'เลขที่สาขา 5 หลักของคู่ค้าที่ออกบิล/รับบิล (ต้องมีในแท็บสาขา) · รายใหม่: สาขาตามแฟ้ม', example: ['', ''] },
  party_address: { key: 'party_address', th: 'ที่อยู่', aliases: ['ที่อยู่ลูกค้า', 'ที่อยู่ผู้จำหน่าย', 'address'], forNew: true, need: 'opt', head: true, hint: 'รายใหม่: ที่อยู่ (ไม่เกิน 300 ตัว)', example: ['', ''] },
  party_phone: { key: 'party_phone', th: 'โทรศัพท์', aliases: ['โทร', 'เบอร์โทร', 'phone'], forNew: true, need: 'opt', head: true, hint: 'รายใหม่: เบอร์โทร', example: ['', ''] },
} satisfies Record<string, ImportColumn>;
const DEPT_COL = { key: 'department', th: 'แผนก', aliases: ['รหัสแผนก', 'department'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามประเภทเอกสาร', head: true, hint: 'รหัสหรือชื่อแผนก', example: ['', ''] } satisfies ImportColumn;
const JOB_COL = { key: 'project', th: 'Job/โครงการ', aliases: ['Job', 'โครงการ', 'รหัส Job', 'project'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่ระบุ', head: true, hint: 'รหัสหรือชื่อ Job — ค่าเริ่มต้นของทุกบรรทัด (Job ที่ปิดแล้วใช้ไม่ได้)', example: ['', ''] } satisfies ImportColumn;
const REF_NO_AP = { key: 'ref_no', th: 'เลขที่ใบกำกับผู้จำหน่าย', aliases: ['เลขที่ใบกำกับผู้ขาย', 'เลขที่บิลผู้จำหน่าย', 'อ้างอิงเอกสาร', 'อ้างอิงลูกค้า'], aliasFor: (k: ImportKindLike) => (k.module === 'AP' ? ['เลขที่ใบกำกับ'] : []), need: 'opt', dflt: 'ค่าเริ่มต้น = เลขที่เอกสาร', head: true,
  thFor: (k: ImportKindLike) => (k.module === 'AR' ? 'อ้างอิงเอกสาร' : 'เลขที่ใบกำกับผู้จำหน่าย'), hint: 'ซื้อ: เลขที่ใบกำกับ/บิลของผู้จำหน่าย (เข้าแฟ้มภาษีซื้อ) · ขาย: เลขที่อ้างอิงที่แสดงในเอกสาร', example: ['', ''] } satisfies ImportColumn;
const REF_DATE_AP = { key: 'ref_date', th: 'วันที่ใบกำกับผู้จำหน่าย', aliases: ['ลงวันที่', 'วันที่ใบกำกับ', 'วันที่บิลผู้จำหน่าย'], need: 'opt', dflt: 'ค่าเริ่มต้น = วันที่เอกสาร', head: true, for: (k: ImportKindLike) => k.module === 'AP' && !k.refInvoice, hint: 'วันที่ตามใบกำกับของผู้จำหน่าย (เข้าแฟ้มภาษีซื้อ)', example: ['', ''] } satisfies ImportColumn;
const PAY_METHOD = { key: 'pay_method', th: 'วิธีชำระ', aliases: ['วิธีรับชำระ', 'วิธีจ่ายชำระ', 'ชำระโดย', 'วิธีชำระเงิน', 'payment'], need: 'opt', dflt: 'ค่าเริ่มต้น = เงินสดทั้งจำนวน', head: true, for: pays,
  hint: 'รหัสหรือชื่อวิธีรับ/จ่ายชำระ (เริ่มระบบ › วิธีรับ/จ่ายชำระหนี้) เช่น เงินโอน QR เช็ค — ใช้ยอดทั้งเอกสาร · แบ่งหลายวิธีใช้แผ่น "รับชำระ"/"จ่ายชำระ"', example: ['', ''] } satisfies ImportColumn;
const PAY_REF = { key: 'pay_ref', th: 'เลขที่อ้างอิง/เช็ค', aliases: ['เลขที่เช็ค', 'อ้างอิงการชำระ', 'เลขที่อ้างอิงการชำระ', 'เลขที่โอน'], need: 'cond', when: 'วิธีชำระเป็นเช็ค', head: true, for: pays, hint: 'เลขที่เช็ค หรือเลขที่อ้างอิงการโอน', example: ['', ''] } satisfies ImportColumn;
const LINE_JOB = { key: 'line_job', th: 'Job รายบรรทัด', aliases: ['Job บรรทัด', 'โครงการรายบรรทัด'], need: 'opt', dflt: 'ค่าเริ่มต้น = Job ของหัวเอกสาร', hint: 'รหัสหรือชื่อ Job ของบรรทัดนี้', example: ['', ''] } satisfies ImportColumn;

/** เลขที่เอกสารกำหนดเอง (HANDOFF 170) — ร่วมกับแบบค่าใช้จ่ายอื่น */
const DOC_NO_COL = { key: 'doc_no', th: 'เลขที่เอกสาร', aliases: ['เลขที่ใบเสร็จ', 'ใบเสร็จรับเงิน', 'เลขที่ใบเสร็จรับเงิน', 'docno', 'doc no', 'document no'], aliasFor: (k: ImportKindLike) => (k.module === 'AR' ? ['เลขที่ใบกำกับ', 'เลขที่ใบกำกับภาษี'] : []), need: 'opt',
  dflt: 'ค่าเริ่มต้น = ออกเลขอัตโนมัติ', head: true,
  hint: 'ใส่เลขเอง: ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสารที่เลือก (เช่น HS…) ไม่เกิน 30 ตัว ไม่มีช่องว่าง ไม่ซ้ำกับเอกสารใดในบริษัท · ว่าง = ระบบออกเลขให้ · ไม่มีคอลัมน์ "เลขที่อ้างอิง" = ใช้เลขนี้รวมแถวเป็นเอกสารเดียว (และเก็บเป็นเลขที่อ้างอิง) — เลขที่ไม่ขึ้นต้นด้วยตัวนำหน้า (เช่นเลขจากโปรแกรมเดิม) ใช้เป็นเลขที่อ้างอิง ระบบออกเลขให้',
  example: ['', ''] } satisfies ImportColumn;
export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่บิล', 'อ้างอิง', 'ref'], required: true, alt: 'doc_no', need: 'cond', when: 'ไม่ใส่เลขที่เอกสาร', head: true, hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บไว้ในช่อง "อ้างอิง" ของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ · ว่างได้ถ้าใส่ "เลขที่เอกสาร"', example: ['INV-0001', 'INV-0001'] },
  DOC_NO_COL,
  { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, need: 'req', head: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] },
  { key: 'party', th: 'รหัสคู่ค้า', aliases: ['รหัสลูกค้า', 'รหัสผู้จำหน่าย', 'ลูกค้า', 'ผู้จำหน่าย', 'คู่ค้า', 'customer', 'supplier'], required: true, alt: 'party_name', need: 'cond', when: 'ไม่ใส่ชื่อหรือเลขผู้เสียภาษี', head: true,
    thFor: (k) => `รหัส${who(k)}`, hint: 'รหัสลูกค้า (เอกสารขาย) หรือรหัสผู้จำหน่าย (เอกสารซื้อ) · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ (ติ๊ก "เพิ่มข้อมูลหลัก" ตอนนำเข้า) · ว่างได้ถ้ามีชื่อ', example: ['C001', 'C001'] },
  { ...PARTY_NEW_COLS.party_name, thFor: (k) => `ชื่อ${who(k)}` },
  PARTY_NEW_COLS.party_branch,
  { key: 'ship_to', th: 'สถานที่ส่งของ', aliases: ['รหัสสถานที่ส่ง', 'สถานที่ส่งสินค้า', 'ship to'], need: 'opt', dflt: 'ค่าเริ่มต้น = สถานที่ส่งประจำของลูกค้า', head: true, for: isAR, hint: 'รหัสสถานที่ส่งในแฟ้มลูกค้า (แท็บสถานที่ส่งสินค้า)', example: ['', ''] },
  { ...REF_NO_AP, for: (k) => !k.refInvoice },
  REF_DATE_AP,
  // ใบสั่งขาย/ใบสั่งซื้อ (HANDOFF 171): วันที่ส่งของ/ถึงกำหนดรับของ — ใบเสนอราคาไม่มีช่องนี้บนหน้าจอ
  { key: 'delivery_date', th: 'วันที่ส่งของ', aliases: ['กำหนดส่ง', 'วันที่ส่ง', 'วันที่รับของ', 'กำหนดรับของ', 'delivery date'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่ระบุ', head: true,
    for: (k) => !!k.order && k.cls !== 'QT', thFor: (k) => (k.module === 'AR' ? 'วันที่ส่งของ' : 'วันที่รับของ'), hint: 'วว/ดด/ปปปป — กำหนดส่งของ (ใบสั่งขาย) / กำหนดรับของ (ใบสั่งซื้อ)', example: ['', ''] },
  { key: 'ref_invoice', th: 'อ้างใบกำกับ', aliases: ['ใบกำกับเดิม', 'อ้างถึงใบกำกับ', 'เลขที่ใบกำกับที่อ้างถึง'], need: 'req', head: true, for: (k) => !!k.refInvoice, hint: 'ใบลดหนี้/เพิ่มหนี้: เลขที่ใบกำกับเดิม', example: ['', ''] },
  { key: 'credit_days', th: 'เครดิต (วัน)', aliases: ['เครดิต', 'จำนวนวันเครดิต', 'credit'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามรายละเอียดลูกค้า/ผู้จำหน่าย', head: true, for: (k) => !pays(k), hint: 'จำนวนวันเครดิต 0–999 (ขาย/ซื้อเงินสดไม่มีช่องนี้ — รับ/จ่ายเงินวันเดียวกัน)', example: ['30', '30'] },
  DEPT_COL, JOB_COL,
  { key: 'salesperson', th: 'พนักงานขาย', aliases: ['รหัสพนักงานขาย', 'salesperson'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามแฟ้มลูกค้า', head: true, for: isAR, hint: 'รหัสหรือชื่อพนักงานขาย', example: ['', ''] },
  { key: 'sales_area', th: 'เขตการขาย', aliases: ['รหัสเขตการขาย', 'เขต'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามแฟ้มลูกค้า', head: true, for: isAR, hint: 'รหัสหรือชื่อเขตการขาย (ตารางข้อมูล 40)', example: ['', ''] },
  { key: 'ship_via', th: 'ขนส่งโดย', aliases: ['รหัสขนส่ง', 'การขนส่ง'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามแฟ้มลูกค้า/ผู้จำหน่าย', head: true, hint: 'รหัสหรือชื่อวิธีขนส่ง (ตารางข้อมูล 41)', example: ['', ''] },
  { key: 'vat_basis', th: 'ภาระภาษี', aliases: ['ภาษีขาย', 'ภาษีซื้อ', 'ภาระภาษีขาย', 'ภาระภาษีซื้อ', 'เกณฑ์ภาษี'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามประเภทเอกสาร (เกณฑ์สิทธิ)', head: true,
    thFor: (k) => (isAR(k) ? 'ภาษีขาย' : 'ภาษีซื้อ'), hint: 'เกณฑ์สิทธิ หรือ เกณฑ์เงินสด (บริการ: ภาษีเกิดเมื่อรับ/จ่ายเงิน)', example: ['', ''] },
  { key: 'bill_discount', th: 'ส่วนลดท้ายบิล', aliases: ['ส่วนลดรวม', 'หักส่วนลด'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่มี', head: true, hint: 'ส่วนลดทั้งบิล เช่น 50 หรือ 5% (ใส่แถวใดแถวหนึ่งของเอกสาร)', example: ['', ''] },
  { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note'], need: 'opt', head: true, hint: 'หมายเหตุของเอกสาร', example: ['นำเข้าจากหน้าร้าน', ''] },
  PAY_METHOD, PAY_REF,
  { key: 'wht_amount', th: 'ภาษีหัก ณ ที่จ่าย', aliases: ['ภาษีถูกหัก ณ ที่จ่าย', 'ถูกหัก ณ ที่จ่าย', 'หัก ณ ที่จ่าย', 'ยอดภาษีหัก ณ ที่จ่าย', 'wht'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่มี', head: true, for: (k) => k.cls === 'HS' || k.cls === 'HP',
    thFor: (k) => (k.cls === 'HS' ? 'ภาษีถูกหัก ณ ที่จ่าย' : 'ภาษีหัก ณ ที่จ่าย'), hint: 'ขายสด: ยอดที่ลูกค้าหักไว้ (ลูกค้าออก 50 ทวิ) · ซื้อสด: ยอดภาษีที่หัก (ว่าง = ฐาน × อัตรา)', example: ['', ''] },
  { key: 'wht_rate', th: 'อัตราหัก ณ ที่จ่าย', aliases: ['อัตราภาษีหัก ณ ที่จ่าย', 'หัก ณ ที่จ่าย %', 'อัตรา wht', 'whtrate'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่หัก', head: true, for: (k) => k.cls === 'HP', hint: 'ร้อยละ เช่น 3 — ฐาน = ยอดก่อน VAT ของเอกสาร', example: ['', ''] },
  { key: 'wht_income', th: 'ประเภทเงินได้', aliases: ['ประเภทเงินได้ที่จ่าย', 'เงินได้'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามอัตรา (3% ค่าบริการ)', head: true, for: (k) => k.cls === 'HP', hint: 'เช่น ค่าบริการ ค่าขนส่ง ค่าเช่า ค่าโฆษณา', example: ['', ''] },
  { key: 'wht_form', th: 'แบบ ภ.ง.ด.', aliases: ['ภ.ง.ด.', 'ภงด'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามผู้จำหน่าย (นิติบุคคล = 53)', head: true, for: (k) => k.cls === 'HP', hint: '3 หรือ 53', example: ['', ''] },
  { key: 'item', th: 'รหัสสินค้า', aliases: ['สินค้า', 'บาร์โค้ด', 'item', 'sku'], required: true, alt: 'item_name', need: 'cond', when: 'ไม่ใส่ชื่อสินค้า', hint: 'รหัสสินค้าหรือบาร์โค้ด · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้ถ้ามีชื่อสินค้า (หาจากชื่อ ไม่พบ = เพิ่มใหม่ ออกรหัสให้)', example: ['A-001', 'S-001'] },
  { key: 'item_name', th: 'ชื่อสินค้า', aliases: ['ชื่อสินค้า/บริการ', 'ชื่อบริการ'], forNew: true, need: 'cond', when: 'ไม่ใส่รหัสสินค้า', hint: 'ชื่อสินค้า — ใช้เมื่อเพิ่มสินค้าใหม่ หรือหาสินค้าเดิมเมื่อไม่ใส่รหัส', example: ['', ''] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description'], need: 'opt', dflt: 'ค่าเริ่มต้น = ชื่อสินค้าในโปรแกรม', hint: 'คำอธิบายรายการ', example: ['', 'ค่าติดตั้ง'] },
  { key: 'warehouse', th: 'คลัง', aliases: ['รหัสคลัง', 'warehouse'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามประเภทเอกสาร/คลังหลัก', hint: 'รหัสหรือชื่อคลัง (สินค้าที่มีสต๊อก)', example: ['', ''] },
  { key: 'qty', th: 'จำนวน', aliases: ['qty', 'quantity'], required: true, need: 'req', hint: 'ตัวเลข', example: ['2', '1'] },
  { key: 'unit', th: 'หน่วย', aliases: ['หน่วยนับ', 'unit'], need: 'opt', dflt: 'ค่าเริ่มต้น = หน่วยย่อยของสินค้า', hint: 'รหัสหน่วยนับ (หน่วยขาย/หน่วยซื้อใช้ตัวคูณของสินค้า) · สินค้าใหม่: หน่วยย่อยของสินค้า (ไม่มีหน่วยนี้ = เพิ่มให้)', example: ['', ''] },
  { key: 'price', th: 'ราคาต่อหน่วย', aliases: ['ราคา', 'ราคา/หน่วย', 'price', 'ราคาต่อหน่วย (ไม่รวมภาษี)', 'ราคาต่อหน่วย (รวมภาษี)', 'ราคาต่อหน่วยก่อนภาษี'], need: 'opt', dflt: 'ค่าเริ่มต้น = 0', hint: 'ตามประเภทราคาที่เลือกตอนนำเข้า (รวมหรือแยกภาษี) · ทศนิยมเกิน 4 ตำแหน่งปัดเป็น 4 ตำแหน่ง (เท่าที่หน้าจอเก็บ)', example: ['150', '500'] },
  { key: 'discount', th: 'ส่วนลด', aliases: ['discount', 'ส่วนลดรายการ', 'ส่วนลด (ไม่รวมภาษี)', 'ส่วนลด (รวมภาษี)'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่มี', hint: 'เช่น 50 หรือ 10% หรือ 5+2%', example: ['10%', ''] },
  { key: 'free', th: 'ของแถม (F)', aliases: ['ของแถม', 'F', 'แถม'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่ใช่', hint: 'ใช่/Y = ของแถม (ไม่คิดเงิน)', example: ['', ''] },
  LINE_JOB,
  { key: 'vat_code', th: 'ประเภท VAT', aliases: ['VAT', 'ประเภทภาษี'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามแฟ้มสินค้า (มีคอลัมน์ "ภาษี VAT" = ตามยอดภาษี)', hint: '1 = มี VAT · 0 = ยกเว้น VAT · 2 = อัตรา 0% — บิลเดียวมีทั้งสินค้ามี VAT และยกเว้นได้ (ใส่ต่อบรรทัด)', example: ['1', '0'] },
  { key: 'vat_amount', th: 'ภาษี VAT', aliases: ['ยอด VAT', 'ยอดภาษี', 'จำนวนภาษี', 'ภาษีมูลค่าเพิ่ม', 'VAT amount', 'vat amt'], need: 'opt', check: true,
    hint: 'ยอดภาษีของบรรทัดจากโปรแกรมเดิม (ไม่บันทึก — โปรแกรมคำนวณเอง): ไม่ใส่ "ประเภท VAT" → ว่าง/0 = ยกเว้น VAT (0) · มากกว่า 0 = มี VAT (1) · ยอดรวมของเอกสารต่างจากที่คำนวณเกิน 0.05 = เตือน', example: ['', ''] },
  { key: 'net_total', th: 'ราคาสุทธิ', aliases: ['ยอดสุทธิ', 'รวมทั้งสิ้น', 'ยอดรวมทั้งสิ้น', 'ราคารวมภาษี', 'ราคารวม (รวมภาษี)', 'จำนวนเงินรวมภาษี', 'ยอดรวม VAT', 'net total'], need: 'opt', check: true,
    hint: 'ยอดรวม VAT ของบรรทัด (หรือยอดทั้งบิลซ้ำทุกแถว) จากโปรแกรมเดิม — ไม่บันทึก ใช้ตรวจยอดรวมทั้งสิ้นของเอกสาร (ต่างเกิน 0.05 = เตือน)', example: ['', ''] },
  { key: 'return', th: 'คืนสินค้า (R)', aliases: ['คืนสินค้า', 'R', 'รับคืนสินค้า', 'ส่งคืนสินค้า'], need: 'opt', dflt: 'ค่าเริ่มต้น = ใช่ (เข้า/ออกสต๊อก)', for: (k) => k.cls === 'CN' || k.cls === 'DN',
    thFor: (k) => (k.cls === 'CN' ? 'รับคืนสินค้า (R)' : 'ส่งคืนสินค้า (R)'), hint: 'ใช่ = สินค้าคืนเข้า/ออกจากสต๊อก · ไม่ใช่ = ลดหนี้เฉพาะราคา', example: ['', ''] },
  PARTY_NEW_COLS.party_tax_id, PARTY_NEW_COLS.party_address, PARTY_NEW_COLS.party_phone,
  { key: 'item_kind', th: 'ชนิดสินค้า', aliases: ['ชนิด', 'สินค้าหรือบริการ'], forNew: true, need: 'opt', dflt: 'ค่าเริ่มต้น = สินค้า', hint: 'สินค้าใหม่: "สินค้า" หรือ "บริการ"', example: ['', 'บริการ'] },
];
/** คอลัมน์ของแบบฟอร์มตามชนิดเอกสาร = ช่องที่หน้าจอเอกสารนั้นมี (HANDOFF 169) */
export function importColumnsFor(k: ImportKindLike): ImportColumn[] {
  return IMPORT_COLUMNS.filter((c) => !c.for || c.for(k)).map((c) => (c.thFor || c.aliasFor ? { ...c, th: c.thFor ? c.thFor(k) : c.th, aliases: [...c.aliases, ...(c.aliasFor?.(k) ?? [])] } : c));
}
/** คอลัมน์ที่ตัวอ่านรู้จัก: ทุกคอลัมน์ (แฟ้มที่มีช่องเกินยังอ่านได้ แล้วเตือน) + ชื่ออื่นเฉพาะชนิดเอกสาร */
export function importReadColumns(k?: ImportKindLike | null): ImportColumn[] {
  return k ? IMPORT_COLUMNS.map((c) => (c.aliasFor ? { ...c, aliases: [...c.aliases, ...c.aliasFor(k)] } : c)) : IMPORT_COLUMNS;
}
/** หัวคอลัมน์ในแบบฟอร์ม: ช่องต้องมีต่อท้าย * (ตัวอ่านไม่สนใจ *) */
export const importHeaderText = (c: Pick<ImportColumn, 'th' | 'need'>) => (c.need === 'req' ? `${c.th} *` : c.th);
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_DOCS = 500;

/** ข้อมูลคู่ค้าจากแฟ้ม: code ว่าง = หาจากเลขผู้เสียภาษี+สาขา แล้วจากชื่อ (ไม่พบ = รายใหม่) */
export interface ImportParty { party: string; party_name: string | null; party_tax_id: string | null; party_branch: string | null; party_address: string | null; party_phone: string | null }
export interface ImportLine { row: number; item: string; item_name: string | null; item_kind: '0' | '3' | null; description: string | null; qty: string; unit: string | null; price: string; discount: string | null; warehouse: string | null;
  /** ของแถม · Job รายบรรทัด · ประเภท VAT · คืนสินค้า (ใบลดหนี้) — null = ค่าเริ่มต้นของหน้าจอ */
  free: boolean | null; job: string | null; vat_code: '0' | '1' | '2' | null; ret: boolean | null;
  /** ยอดภาษี/ยอดรวม VAT ของบรรทัดตามแฟ้ม (ตรวจยอด · HANDOFF 170) */
  vat_amount: string | null; net_total: string | null }
export interface ImportDoc extends ImportParty { ref: string; row: number; date: string;
  /** เลขที่เอกสารกำหนดเอง (ว่าง = อัตโนมัติ · HANDOFF 170) */
  doc_no: string | null; ref_invoice: string | null; credit_days: number | null; remark: string | null;
  ship_to: string | null; ref_no: string | null; ref_date: string | null; delivery_date: string | null; department: string | null; project: string | null; salesperson: string | null; sales_area: string | null; ship_via: string | null;
  vat_basis: '1' | '2' | null; bill_discount: string | null; pay_method: string | null; pay_ref: string | null; wht: ExpenseImportWht | null; lines: ImportLine[] }
export interface ImportIssue { row: number; message: string }

const norm = (s: string) => s.replace(/[\s_\-().%*]/g, '').toLowerCase();

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

const SECOND_COL: Record<string, string> = { item: 'item_name', party: 'party_name' };
/** หาหัวตารางจากชื่อคอลัมน์ (แถวแรกที่ตรงอย่างน้อย 3 ชื่อ ภายใน 20 แถวแรก) ลำดับคอลัมน์สลับได้ */
function findHeader<K extends string>(rows: string[][], columns: Array<{ key: K; th: string; aliases: readonly string[]; required?: boolean; alt?: K }>):
  { headAt: number; cols: Map<K, number> } | { error: ImportIssue } {
  const lookup = new Map<string, K>();
  for (const c of columns) for (const n of [c.th, ...c.aliases]) lookup.set(norm(n), c.key);
  const keys = new Set<string>(columns.map((c) => c.key));
  const thOf = new Map<string, string>(columns.map((c) => [c.key, norm(c.th)]));
  let headAt = -1;
  const cols = new Map<K, number>();
  for (let r = 0; r < Math.min(rows.length, 20) && headAt < 0; r++) {
    const hits = rows[r]!.map((x, i) => [lookup.get(norm(String(x ?? ''))), i] as const).filter((x): x is readonly [K, number] => !!x[0]);
    if (hits.length >= 3) {
      headAt = r;
      // ชื่อเดียวกันสองคอลัมน์ (เช่น "รหัสสินค้า" แล้ว "สินค้า") — คอลัมน์ที่สองเป็นชื่อ (HANDOFF 170)
      for (const [k, i] of hits) {
        const k2 = SECOND_COL[k] as K | undefined;
        if (!cols.has(k)) { cols.set(k, i); continue; }
        if (!k2 || !keys.has(k2) || cols.has(k2)) continue;
        // หัวที่ตรงชื่อหลักของคอลัมน์ (รหัสสินค้า) เป็นรหัส · อีกคอลัมน์ (สินค้า) เป็นชื่อ — ลำดับใดก็ได้
        if (norm(String(rows[r]![i] ?? '')) === thOf.get(k)) { cols.set(k2, cols.get(k)!); cols.set(k, i); } else cols.set(k2, i);
      }
    }
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
/** แถวต่อมาของเอกสารเดียวกันที่ไม่ใส่คู่ค้าเลย (รหัส ชื่อ เลขผู้เสียภาษี ว่าง) = คู่ค้าของแถวแรก */
function inheritParty(p: ImportParty | null, first: ImportParty | undefined): ImportParty | null {
  if (!p || !first || p.party || p.party_name || p.party_tax_id) return p;
  return { party: first.party, party_name: first.party_name, party_tax_id: first.party_tax_id, party_branch: p.party_branch ?? first.party_branch, party_address: p.party_address ?? first.party_address, party_phone: p.party_phone ?? first.party_phone };
}
/** ช่องหัวเอกสารที่แถวต่อมาใส่ค่าไม่ตรงกับแถวแรก = ผิด บอกคอลัมน์และแถว (ช่องว่าง = ตามแถวแรก · ช่องที่มีกติกาเฉพาะอยู่แล้วข้าม) */
function headConflicts(ref: string, doc: { row: number }, head: Record<string, unknown>, skip: string[], thOf: (k: string) => string, bad: (m: string) => void) {
  const d0 = doc as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(head)) {
    if (skip.includes(k) || v === null || v === undefined || d0[k] === null || d0[k] === undefined) continue;
    if (String(v) !== String(d0[k])) bad(`เลขที่อ้างอิง ${ref}: คอลัมน์ "${thOf(k)}" = "${String(v)}" ไม่ตรงกับแถว ${doc.row} ("${String(d0[k])}") — ช่องหัวเอกสารใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม`);
  }
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
 * HANDOFF 169: อ่านทุกช่องของหน้าจอเอกสาร (หัว + บรรทัด + วิธีชำระ) — ช่องที่ชนิดเอกสารนั้นไม่มี เซิร์ฟเวอร์ไม่ใช้และเตือน (cols = คอลัมน์ที่พบในแฟ้ม)
 */
export function mapImport(rows: string[][], ys: YearSystem, kind?: ImportKindLike | null): { docs: ImportDoc[]; errors: ImportIssue[]; cols: ImportKey[] } {
  const errors: ImportIssue[] = [];
  const readCols = importReadColumns(kind);
  const docKind = kind;
  const h = findHeader(rows, readCols);
  if ('error' in h) return { docs: [], errors: [h.error], cols: [] };
  const { headAt, cols } = h;
  const docs = new Map<string, ImportDoc>();
  const docNoAt = new Map<string, { ref: string; row: number }>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const cell = (k: ImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: no, message: m });
    const n0 = errors.length;
    // เลขที่เอกสาร (HANDOFF 170): ไม่มีเลขที่อ้างอิง = ใช้เลขที่เอกสารรวมแถวและเก็บเป็นเลขที่อ้างอิง
    const docNo = cell('doc_no');
    const ref = cell('ref') || docNo, item = cell('item'), itemName = cell('item_name').slice(0, 120);
    if (!ref) { bad(`ไม่มีเลขที่อ้างอิง (คอลัมน์ "เลขที่อ้างอิง"${cols.has('doc_no') ? ' หรือ "เลขที่เอกสาร"' : ''} ต้องมีทุกแถว — แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว)`); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const docNoBad = importDocNoError(docNo);
    if (docNoBad) bad(docNoBad);
    // แถวต่อมาของเอกสารเดียวกัน (เลขที่อ้างอิง/เลขที่เอกสารเดียวกัน): ช่องหัวเอกสารที่ว่าง = ตามแถวแรก (HANDOFF 170 ข้อ G — ตามแผ่นคำอธิบาย "ใส่แถวแรกพอ")
    const first = docs.get(ref);
    const date = !cell('date') && first ? first.date : importDate(cell('date'), ys);
    if (!date) bad(`วันที่ "${cell('date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const p = inheritParty(partyCells(cell, bad), first);
    if (p && !p.party && !p.party_name && !p.party_tax_id) bad('ไม่มีรหัสคู่ค้า (คู่ค้าใหม่: ใส่ชื่อคู่ค้า)');
    if (!item && !itemName) bad('ไม่มีรหัสสินค้า (สินค้าใหม่: ใส่ชื่อสินค้า)');
    if (item.length > 30) bad(`รหัสสินค้า "${item}" ยาวเกิน 30 ตัว`);
    const kind = importItemKind(cell('item_kind'));
    if (kind === undefined) bad(`ชนิดสินค้า "${cell('item_kind')}" ใช้ "สินค้า" หรือ "บริการ"`);
    const qtyT = cell('qty'), qty = importNumber(qtyT);
    if (!qtyT) bad('ไม่มีจำนวน (คอลัมน์ "จำนวน" ต้องมี)');
    else if (qty === null) bad(`จำนวน "${qtyT}" ไม่ใช่ตัวเลข`);
    // ราคาทศนิยมยาวจากโปรแกรมอื่น (เช่น 5854.2056074766) → 4 ตำแหน่งเท่าที่หน้าจอเก็บ (doc_line.unit_price numeric(18,4)) — ยอดบรรทัด/ภาษีจึงเท่ากับบันทึกจากหน้าจอ
    const price = importPrice(cell('price') || '0');
    if (price === null) bad(`ราคาต่อหน่วย "${cell('price')}" ไม่ใช่ตัวเลข`);
    const vatAmtT = cell('vat_amount'), vatAmt = vatAmtT ? importNumber(vatAmtT) : null;
    if (vatAmtT && vatAmt === null) bad(`ภาษี VAT "${vatAmtT}" ไม่ใช่ตัวเลข (คอลัมน์ "ภาษี VAT" — เว้นว่างได้ถ้าไม่มีภาษี)`);
    const netT = cell('net_total'), netTotal = netT ? importNumber(netT) : null;
    if (netT && netTotal === null) bad(`ราคาสุทธิ "${netT}" ไม่ใช่ตัวเลข (คอลัมน์ "ราคาสุทธิ")`);
    const cd = cell('credit_days');
    const credit = cd ? Number(cd.replace(/,/g, '')) : null;
    if (credit !== null && !(Number.isInteger(credit) && credit >= 0 && credit <= 999)) bad(`เครดิต "${cd}" ต้องเป็นจำนวนวัน 0–999`);
    const refDateT = cell('ref_date'), refDate = refDateT ? importDate(refDateT, ys) : null;
    if (refDateT && !refDate) bad(`วันที่ใบกำกับ "${refDateT}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const delT = cell('delivery_date'), delivery = delT ? importDate(delT, ys) : null;
    if (delT && !delivery) bad(`วันที่ส่งของ "${delT}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const basis = importVatBasis(cell('vat_basis'));
    if (basis === undefined) bad(`ภาระภาษี "${cell('vat_basis')}" ใช้ "เกณฑ์สิทธิ" หรือ "เกณฑ์เงินสด"`);
    const free = importFlag(cell('free')), ret = importFlag(cell('return'));
    if (free === undefined) bad(`ของแถม "${cell('free')}" ใช้ ใช่/ไม่ใช่ (Y/N)`);
    if (ret === undefined) bad(`คืนสินค้า "${cell('return')}" ใช้ ใช่/ไม่ใช่ (Y/N)`);
    const vatCode0 = importVatCode(cell('vat_code'));
    if (vatCode0 === undefined) bad(`ประเภท VAT "${cell('vat_code')}" ใช้ 1 = มี VAT · 0 = ยกเว้น · 2 = อัตรา 0%`);
    // ไม่ใส่ประเภท VAT แต่มีคอลัมน์ยอดภาษี: ว่าง/0 = ยกเว้น · มีภาษี = มี VAT (ไม่ใช้ค่าเริ่มต้นของสินค้า — ตามที่แฟ้มบอก)
    const vatCode = vatCode0 ?? (cols.has('vat_amount') ? (vatAmt && Number(vatAmt) !== 0 ? '1' : '0') : null);
    const wht = whtCells((k) => cell(k as ImportKey), bad);
    if (errors.length > n0 || !date || !p || qty === null || price === null) continue;
    const head = {
      date, doc_no: docNo || null, ref_invoice: cell('ref_invoice') || null, credit_days: credit, remark: cell('remark') || null, ship_to: cell('ship_to') || null, ref_no: cell('ref_no').slice(0, 30) || null, ref_date: refDate, delivery_date: delivery,
      department: cell('department') || null, project: cell('project') || null, salesperson: cell('salesperson') || null, sales_area: cell('sales_area') || null, ship_via: cell('ship_via') || null,
      vat_basis: basis ?? null, bill_discount: cell('bill_discount') || null, pay_method: cell('pay_method') || null, pay_ref: cell('pay_ref').slice(0, 30) || null, wht,
    };
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
      if (head.doc_no && doc.doc_no && head.doc_no !== doc.doc_no) bad(`เลขที่อ้างอิง ${ref}: เลขที่เอกสาร ${head.doc_no} ไม่ตรงกับแถว ${doc.row} (${doc.doc_no}) — หนึ่งเอกสารใช้เลขที่เดียว`);
      if (head.ref_invoice && doc.ref_invoice && head.ref_invoice !== doc.ref_invoice) bad(`เลขที่อ้างอิง ${ref}: อ้างใบกำกับไม่ตรงกับแถว ${doc.row}`);
      if (head.pay_method && doc.pay_method && head.pay_method !== doc.pay_method) bad(`เลขที่อ้างอิง ${ref}: วิธีชำระไม่ตรงกับแถว ${doc.row} — ใส่แถวเดียว หรือใช้แผ่น "รับชำระ"/"จ่ายชำระ" เมื่อแบ่งหลายวิธี`);
      if (wht && doc.wht && JSON.stringify(wht) !== JSON.stringify(doc.wht)) bad(`เลขที่อ้างอิง ${ref}: ภาษีหัก ณ ที่จ่ายไม่ตรงกับแถว ${doc.row} — ใส่แถวเดียวของเอกสาร`);
      headConflicts(ref, doc, head, ['date', 'doc_no', 'ref_invoice', 'pay_method', 'wht'], (k) => { const c = readCols.find((x) => x.key === k); return c ? (docKind && c.thFor ? c.thFor(docKind) : c.th) : k; }, bad);
      if (errors.length > before) continue;
      const d0 = doc as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(head)) if (k !== 'date' && (d0[k] === null || d0[k] === undefined)) d0[k] = v;
    }
    // แฟ้มเก่าที่ใช้หัว "ชื่อสินค้า" เป็นรายละเอียด (ไม่มีคอลัมน์ รายละเอียด) — ยังได้รายละเอียดเหมือนเดิม
    const description = cell('description') || (!cols.has('description') && itemName ? itemName : '') || null;
    // เลขที่เอกสารซ้ำกันในแฟ้ม (คนละเลขที่อ้างอิง) = ผิด
    if (doc.doc_no) {
      const at = docNoAt.get(doc.doc_no.toUpperCase());
      if (at && at.ref !== ref) { bad(`เลขที่เอกสาร ${doc.doc_no} ซ้ำกับเลขที่อ้างอิง ${at.ref} (แถว ${at.row}) — หนึ่งเลขที่ใช้ได้เอกสารเดียว`); if (doc.lines.length === 0) docs.delete(ref); continue; }
      if (!at) docNoAt.set(doc.doc_no.toUpperCase(), { ref, row: doc.row });
    }
    doc.lines.push({ row: no, item, item_name: itemName || null, item_kind: kind ?? null, description, qty, unit: cell('unit') || null, price, discount: importNoDiscount(cell('discount')) ? null : cell('discount') || null, warehouse: cell('warehouse') || null,
      free: free ?? null, job: cell('line_job') || null, vat_code: vatCode ?? null, ret: ret ?? null, vat_amount: vatAmt ?? (cols.has('vat_amount') ? '0' : null), net_total: netTotal ?? null });
  }
  if (!docs.size && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { docs: [...docs.values()], errors, cols: [...cols.keys()] };
}

/** เลขที่เอกสารกำหนดเอง: รูปแบบเดียวกับช่องเลขที่เอกสารบนหน้าจอ (docNoInput) — ตัวนำหน้าตามประเภทเอกสารตรวจที่เซิร์ฟเวอร์ */
export function importDocNoError(v: string): string | null {
  if (!v) return null;
  if (v.length > 30) return `เลขที่เอกสาร "${v}" ยาวเกิน 30 ตัว`;
  if (!/^[A-Za-z0-9ก-๙/._-]+$/.test(v)) return `เลขที่เอกสาร "${v}" ใช้ได้เฉพาะตัวอักษร ตัวเลข และ / - . _ (ไม่มีช่องว่าง)`;
  return null;
}
/** ส่วนลด 0 / 0.00 จากโปรแกรมอื่น = ไม่มีส่วนลด */
const importNoDiscount = (v: string) => { const n = v ? importNumber(v) : null; return n !== null && Number(n) === 0; };
/** ราคาต่อหน่วยจากแฟ้ม → ทศนิยมไม่เกิน 4 ตำแหน่ง (ปัดครึ่งขึ้น เท่าที่หน้าจอเก็บ) */
export function importPrice(v: string): string | null {
  const n = importNumber(v);
  if (n === null) return null;
  // ปัดจากค่าเดิมในแฟ้ม (importNumber ตัดที่ 6 ตำแหน่งก่อน — ปัดสองครั้งอาจเพี้ยน)
  let t = v.trim().replace(/[,\s฿]/g, '');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);
  const x = d(t);
  return x.decimalPlaces() > 4 ? x.toDecimalPlaces(4).toString() : n;
}
/** ใช่/ไม่ใช่ จากแฟ้ม: ว่าง = null · ใช่ Y 1 ✓ x true = true · ไม่ใช่ N 0 false = false · อื่น ๆ = undefined */
export function importFlag(v: string): boolean | null | undefined {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (['ใช่', 'y', 'yes', '1', '✓', '✔', 'x', 'true', 'แถม', 'คืน', 'f', 'r'].includes(t)) return true;
  if (['ไม่ใช่', 'ไม่', 'n', 'no', '0', 'false', '-'].includes(t)) return false;
  return undefined;
}
/** ภาระภาษี: เกณฑ์สิทธิ = 1 · เกณฑ์เงินสด = 2 */
export function importVatBasis(v: string): '1' | '2' | null | undefined {
  const t = v.replace(/\s/g, '').toLowerCase();
  if (!t) return null;
  if (['เกณฑ์สิทธิ', 'สิทธิ', '1', 'accrual'].includes(t)) return '1';
  if (['เกณฑ์เงินสด', 'เงินสด', '2', 'cash'].includes(t)) return '2';
  return undefined;
}
/** ประเภท VAT รายบรรทัด: 1 มี VAT · 0 ยกเว้น · 2 อัตรา 0% */
export function importVatCode(v: string): '0' | '1' | '2' | null | undefined {
  const t = v.replace(/\s/g, '').toLowerCase();
  if (!t) return null;
  if (['1', 'มีvat', 'มี', 'vat', '7%', '7'].includes(t)) return '1';
  if (['0', 'ยกเว้น', 'ยกเว้นvat', 'exempt'].includes(t)) return '0';
  if (['2', '0%', 'อัตรา0', 'อัตรา0%', 'zero'].includes(t)) return '2';
  return undefined;
}
/** ภาษีหัก ณ ที่จ่ายของเอกสาร (อัตรา/ยอด/ประเภทเงินได้/แบบ) — ใช้ร่วมกับซื้อเงินสดและค่าใช้จ่ายอื่น */
function whtCells(cell: (k: string) => string, bad: (m: string) => void): ExpenseImportWht | null {
  const rateT = cell('wht_rate').replace(/%$/, ''), amtT = cell('wht_amount');
  const rate = rateT ? importNumber(rateT) : null, wamt = amtT ? importNumber(amtT) : null;
  if (rateT && (rate === null || Number(rate) < 0 || Number(rate) > 100)) bad(`อัตราหัก ณ ที่จ่าย "${cell('wht_rate')}" ต้องเป็นร้อยละ 0–100`);
  if (amtT && (wamt === null || Number(wamt) < 0)) bad(`ภาษีหัก ณ ที่จ่าย "${amtT}" ไม่ใช่จำนวนเงิน`);
  const form = importWhtForm(cell('wht_form'));
  if (form === undefined) bad(`แบบ ภ.ง.ด. "${cell('wht_form')}" ใช้ 3 หรือ 53`);
  const has = (rate !== null && Number(rate) > 0) || (wamt !== null && Number(wamt) > 0);
  return has ? { rate: rate !== null && Number(rate) > 0 ? rate : null, amount: wamt !== null && Number(wamt) > 0 ? wamt : null, income: cell('wht_income').slice(0, 60) || null, form: form ?? null } : null;
}

/* ------------------------------------------------------------ แผ่น "รับชำระ"/"จ่ายชำระ" (แบ่งหลายวิธี · HANDOFF 169) */

export type PaymentImportKey = 'ref' | 'method' | 'amount' | 'pay_ref' | 'cheque_date';
export const PAYMENT_IMPORT_COLUMNS: Array<{ key: PaymentImportKey; th: string; aliases: string[]; required?: boolean; need: ImportNeed; when?: string; dflt?: string; hint: string; example: [string, string] }> = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่เอกสาร', 'เลขที่บิล', 'อ้างอิง'], required: true, need: 'req', hint: 'เลขที่อ้างอิงของเอกสารในแผ่นนำเข้า (หลายแถว = หลายวิธีของเอกสารเดียวกัน)', example: ['INV-0001', 'INV-0001'] },
  { key: 'method', th: 'วิธีชำระ', aliases: ['วิธีรับชำระ', 'วิธีจ่ายชำระ', 'ชำระโดย', 'วิธีชำระเงิน'], required: true, need: 'req', hint: 'รหัสหรือชื่อวิธีรับ/จ่ายชำระที่ไม่ใช่เงินสด (เงินโอน QR เช็ค บัตร …) — ส่วนที่เหลือเป็นเงินสดให้เอง', example: ['เงินโอน', 'เงินโอน'] },
  { key: 'amount', th: 'จำนวนเงิน', aliases: ['ยอดเงิน', 'ยอดชำระ', 'amount'], required: true, need: 'req', hint: 'ยอดของวิธีนี้ · รวมทุกแถวของเอกสารไม่เกินยอดที่ต้องรับ/จ่าย (รวมทั้งสิ้น − ภาษีหัก ณ ที่จ่าย) · ส่วนที่เหลือ = เงินสด', example: ['1000', '605'] },
  { key: 'pay_ref', th: 'เลขที่อ้างอิง/เช็ค', aliases: ['เลขที่เช็ค', 'อ้างอิงการชำระ', 'เลขที่โอน'], need: 'cond', when: 'วิธีชำระเป็นเช็ค', hint: 'เลขที่เช็ค หรือเลขที่อ้างอิงการโอน', example: ['', 'TR-0001'] },
  { key: 'cheque_date', th: 'วันที่เช็ค', aliases: ['ลงวันที่เช็ค'], need: 'opt', dflt: 'ค่าเริ่มต้น = วันที่เอกสาร', hint: 'ค่าใช้จ่ายอื่น: วันที่หน้าเช็คที่จ่าย', example: ['', ''] },
];
export interface ImportPayment { row: number; ref: string; method: string; amount: string; pay_ref: string | null; cheque_date: string | null }
/** แผ่นรับ/จ่ายชำระ → รายการต่อเอกสาร (ตามเลขที่อ้างอิง) */
export function mapPaymentImport(rows: string[][], ys: YearSystem): { pays: ImportPayment[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  if (!rows.some((r) => r.some((c) => String(c ?? '').trim()))) return { pays: [], errors };
  const h = findHeader(rows, PAYMENT_IMPORT_COLUMNS);
  if ('error' in h) return { pays: [], errors: [{ ...h.error, message: `แผ่นรับ/จ่ายชำระ: ${h.error.message}` }] };
  const pays: ImportPayment[] = [];
  for (let r = h.headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const cell = (k: PaymentImportKey) => { const i = h.cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: r + 1, message: `แผ่นรับ/จ่ายชำระ: ${m}` });
    const n0 = errors.length;
    const ref = cell('ref'), method = cell('method'), amount = importNumber(cell('amount'));
    if (!ref) bad('ไม่มีเลขที่อ้างอิง');
    if (!method) bad('ไม่มีวิธีชำระ');
    if (amount === null || Number(amount) <= 0) bad(`จำนวนเงิน "${cell('amount')}" ต้องเป็นตัวเลขมากกว่า 0`);
    const cdT = cell('cheque_date'), cd = cdT ? importDate(cdT, ys) : null;
    if (cdT && !cd) bad(`วันที่เช็ค "${cdT}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    if (errors.length > n0) continue;
    pays.push({ row: r + 1, ref, method, amount: amount!, pay_ref: cell('pay_ref').slice(0, 30) || null, cheque_date: cd });
  }
  return { pays, errors };
}

/* ------------------------------------------------------------ ค่าใช้จ่ายอื่น ๆ (OE · HANDOFF 167) */

export type ExpenseImportKey = 'ref' | 'doc_no' | 'date' | 'party' | 'party_name' | 'code' | 'description' | 'amount' | 'wht_rate' | 'wht_amount' | 'wht_income' | 'wht_form' | 'remark' | 'ref_no' | 'ref_date' | 'department' | 'project' | 'pay_method' | 'pay_ref' | 'line_job'
  | 'party_tax_id' | 'party_branch' | 'party_address' | 'party_phone';
export interface ExpenseImportColumn { key: ExpenseImportKey; th: string; aliases: readonly string[]; required?: boolean; hint: string; example: [string, string]; forNew?: boolean; alt?: ExpenseImportKey; need: ImportNeed; when?: string; dflt?: string; head?: boolean }
/** คอลัมน์ร่วมกับแบบขาย/ซื้อ — ค่าใช้จ่ายอื่นมีหน้าจอเดียว (ไม่เลือกตามชนิด) */
const plain = ({ for: _f, thFor: _t, alt: _a, aliasFor: _x, check: _c, ...c }: ImportColumn) => c;
export const EXPENSE_IMPORT_COLUMNS: ExpenseImportColumn[] = [
  { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'เลขที่บิล', 'อ้างอิง', 'ref'], required: true, alt: 'doc_no', need: 'cond', when: 'ไม่ใส่เลขที่เอกสาร', head: true, hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บในช่อง "อ้างอิง" ของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ · ว่างได้ถ้าใส่ "เลขที่เอกสาร"', example: ['EXP-0001', 'EXP-0001'] },
  { ...plain(DOC_NO_COL), key: 'doc_no', aliases: ['docno', 'doc no', 'document no'], hint: DOC_NO_COL.hint.replace('HS…', 'OE…') },
  { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, need: 'req', head: true, hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] },
  { key: 'party', th: 'รหัสผู้จำหน่าย', aliases: ['ผู้จำหน่าย', 'รหัสคู่ค้า', 'supplier'], need: 'cond', when: 'ไม่ใส่ชื่อผู้จำหน่าย', head: true, hint: 'รหัสผู้จำหน่าย · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้: ใส่ชื่อผู้จำหน่าย (มีเลขผู้เสียภาษี = หา/เพิ่มในทะเบียน · ชื่ออย่างเดียวที่ไม่มีในทะเบียน = ใส่ชื่อในเอกสาร ไม่เพิ่มผู้จำหน่าย)', example: ['S001', 'S001'] },
  { ...PARTY_NEW_COLS.party_name, key: 'party_name', th: 'ชื่อผู้จำหน่าย', aliases: ['ชื่อคู่ค้า', 'ชื่อผู้ขาย', 'ผู้รับเงิน'], need: 'cond', when: 'ไม่ใส่รหัสผู้จำหน่าย', hint: 'ชื่อผู้จำหน่าย/ผู้รับเงิน — ใช้เมื่อไม่ใส่รหัส หรือเพิ่มผู้จำหน่ายใหม่' },
  { ...plain(PARTY_NEW_COLS.party_branch), key: 'party_branch', th: 'สาขาผู้ขาย' },
  { ...plain(REF_NO_AP), key: 'ref_no', th: 'เลขที่ใบกำกับผู้จำหน่าย', aliases: [...REF_NO_AP.aliases, 'เลขที่ใบกำกับ'] },
  { ...plain(REF_DATE_AP), key: 'ref_date' },
  { ...DEPT_COL, key: 'department' }, { ...JOB_COL, key: 'project' },
  { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note'], need: 'opt', head: true, hint: 'หมายเหตุของเอกสาร', example: ['', ''] },
  { ...plain(PAY_METHOD), key: 'pay_method' }, { ...plain(PAY_REF), key: 'pay_ref' },
  { key: 'wht_rate', th: 'อัตราหัก ณ ที่จ่าย', aliases: ['อัตราภาษีหัก ณ ที่จ่าย', 'หัก ณ ที่จ่าย %', 'อัตรา wht', 'whtrate'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่หัก', head: true, hint: 'ร้อยละ เช่น 3 — ต่อเอกสาร (ใส่แถวใดแถวหนึ่ง) · ฐาน = ยอดก่อน VAT ของเอกสาร', example: ['3', ''] },
  { key: 'wht_amount', th: 'ภาษีหัก ณ ที่จ่าย', aliases: ['หัก ณ ที่จ่าย', 'ยอดภาษีหัก ณ ที่จ่าย', 'wht'], need: 'opt', dflt: 'ค่าเริ่มต้น = ฐาน × อัตรา', head: true, hint: 'ใส่ยอดอย่างเดียวได้ (คำนวณอัตราให้)', example: ['', ''] },
  { key: 'wht_income', th: 'ประเภทเงินได้', aliases: ['ประเภทเงินได้ที่จ่าย', 'เงินได้'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามอัตรา (3% ค่าบริการ 1% ค่าขนส่ง 2% ค่าโฆษณา 5% ค่าเช่า)', head: true, hint: 'เช่น ค่าบริการ ค่าขนส่ง ค่าเช่า ค่าโฆษณา', example: ['ค่าขนส่ง', ''] },
  { key: 'wht_form', th: 'แบบ ภ.ง.ด.', aliases: ['ภ.ง.ด.', 'ภงด', 'แบบ'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามผู้จำหน่าย (นิติบุคคล = 53)', head: true, hint: '3 หรือ 53', example: ['53', ''] },
  { key: 'code', th: 'รหัสค่าใช้จ่าย', aliases: ['รหัส', 'ค่าใช้จ่าย', 'รหัสค่าใช้จ่ายอื่น', 'expense'], required: true, need: 'req', hint: 'รหัสหรือชื่อค่าใช้จ่ายอื่นที่มีในโปรแกรมแล้ว (ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ — ต้องมีบัญชีค่าใช้จ่าย จึงไม่เพิ่มให้อัตโนมัติ)', example: ['E-001', 'E-002'] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description', 'คำอธิบาย'], need: 'opt', dflt: 'ค่าเริ่มต้น = ชื่อรหัสค่าใช้จ่าย', hint: 'คำอธิบายรายการ', example: ['ค่าขนส่งเดือน ต.ค.', ''] },
  { key: 'amount', th: 'จำนวนเงิน', aliases: ['ยอดเงิน', 'จำนวน', 'amount'], required: true, need: 'req', hint: 'ตามประเภทราคาที่เลือกตอนนำเข้า (รวมหรือแยกภาษี) · มากกว่า 0', example: ['1000', '250'] },
  { ...LINE_JOB, key: 'line_job' },
  { ...PARTY_NEW_COLS.party_tax_id, key: 'party_tax_id' }, { ...PARTY_NEW_COLS.party_address, key: 'party_address' }, { ...PARTY_NEW_COLS.party_phone, key: 'party_phone' },
];
/**
 * คอลัมน์ของแบบนำเข้าเอกสารรับ/จ่ายเงิน ตามหน้าจอของชนิดนั้น (HANDOFF 171) — ไม่ระบุ = ค่าใช้จ่ายอื่น (OE)
 * มัดจำรับ/จ่าย (AI/AE): บรรทัด = รายละเอียด + จำนวนเงิน (ไม่มีรหัส) · รายได้อื่น (OI): รหัสรายได้ · ฝั่งรับเงิน (AI/OI): ลูกค้า ไม่มีเลขที่ใบกำกับผู้จำหน่าย
 * ภาษีหัก ณ ที่จ่าย: ฝั่งจ่าย (AE/OE) = อัตรา/ยอด/ประเภทเงินได้/แบบ ภ.ง.ด. · ฝั่งรับ (AI/OI) = ยอดที่ลูกค้าหักไว้อย่างเดียว (เหมือนหน้าจอ)
 * ชื่อหัวคอลัมน์ของค่าใช้จ่ายอื่นยังอ่านได้ทุกชนิด (ใช้เป็นชื่ออื่น)
 */
export function cashImportColumnsFor(cls?: string | null): ExpenseImportColumn[] {
  const k = CASH_KINDS.find((x) => x.cls === cls);
  if (!k || k.cls === 'OE') return EXPENSE_IMPORT_COLUMNS;
  const cust = k.party === 'customer', w = cust ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const keep = (c: ExpenseImportColumn) => [...c.aliases, c.th];
  return EXPENSE_IMPORT_COLUMNS.flatMap((c): ExpenseImportColumn[] => {
    if (k.lines === 'text' && c.key === 'code') return [];
    if (cust && (c.key === 'ref_no' || c.key === 'ref_date')) return [];
    if (!k.whtEntries && (c.key === 'wht_rate' || c.key === 'wht_income' || c.key === 'wht_form')) return [];
    switch (c.key) {
      case 'ref': return [{ ...c, example: [`${k.cls}-0001`, k.lines === 'text' ? `${k.cls}-0002` : `${k.cls}-0001`] }];
      case 'doc_no': return [{ ...c, hint: c.hint.replace('OE…', `${k.cls}…`) }];
      case 'party': return [{ ...c, th: `รหัส${w}`, aliases: keep(c), when: `ไม่ใส่ชื่อ${w}`, need: 'cond',
        hint: k.partyRequired ? `รหัส${w} (${k.label}ต้องมี${w}) · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้: ใส่ชื่อ${w}/เลขผู้เสียภาษี (หา/เพิ่มในทะเบียน)`
          : `รหัส${w} · ไม่มีในโปรแกรม = เพิ่มใหม่ด้วยรหัสนี้ · ว่างได้: ใส่ชื่อ${w} (มีเลขผู้เสียภาษี = หา/เพิ่มในทะเบียน · ชื่ออย่างเดียวที่ไม่มีในทะเบียน = ใส่ชื่อในเอกสาร)`,
        example: cust ? ['C001', 'C001'] : c.example }];
      case 'party_name': return [{ ...c, th: `ชื่อ${w}`, aliases: [...keep(c), 'ชื่อลูกค้า', 'ผู้จ่ายเงิน'], when: `ไม่ใส่รหัส${w}`, hint: `ชื่อ${w} — ใช้เมื่อไม่ใส่รหัส หรือเพิ่ม${w}ใหม่` }];
      case 'party_branch': return [{ ...c, th: cust ? 'Bill to (สาขาลูกค้า)' : c.th, aliases: keep(c) }];
      case 'wht_amount': return cust ? [{ ...c, dflt: 'ค่าเริ่มต้น = ไม่หัก', hint: 'ยอดที่ลูกค้าหัก ณ ที่จ่ายไว้ (ต่อเอกสาร — ใส่แถวใดแถวหนึ่ง)', example: ['', ''] }] : [c];
      case 'code': return [{ ...c, th: 'รหัสรายได้', aliases: [...keep(c), 'รายได้', 'รหัสรายได้อื่น', 'income'], hint: 'รหัสหรือชื่อรายได้อื่นที่มีในโปรแกรมแล้ว (ขาย › รายละเอียดรายได้อื่น ๆ — ต้องมีบัญชีรายได้ จึงไม่เพิ่มให้อัตโนมัติ)', example: ['I-001', 'I-002'] }];
      case 'description': return k.lines === 'text'
        ? [{ ...c, required: true, need: 'req', dflt: undefined, hint: `รายละเอียดของ${k.label} (บรรทัดละรายการ) — หน้าจอต้องมีรายละเอียดทุกบรรทัด`, example: ['มัดจำค่าสินค้าตามใบสั่งซื้อ', 'มัดจำงานติดตั้ง'] }]
        : [{ ...c, dflt: 'ค่าเริ่มต้น = ชื่อรหัสรายได้', example: ['ค่าเช่าเดือน ต.ค.', ''] }];
      default: return [c];
    }
  });
}
export interface ExpenseImportWht { rate: string | null; amount: string | null; income: string | null; form: 'S03' | 'S53' | null }
export interface ExpenseImportLine { row: number; code: string; description: string | null; amount: string; job: string | null }
export interface ExpenseImportDoc extends ImportParty { ref: string; row: number; date: string; doc_no: string | null; remark: string | null; wht: ExpenseImportWht | null; lines: ExpenseImportLine[];
  ref_no: string | null; ref_date: string | null; department: string | null; project: string | null; pay_method: string | null; pay_ref: string | null }

/** แบบ ภ.ง.ด. จากแฟ้ม: 3 / ภ.ง.ด.3 / S03 → S03 · 53 → S53 · ว่าง = null · อื่น ๆ = undefined */
export function importWhtForm(v: string): 'S03' | 'S53' | null | undefined {
  const t = v.replace(/[\s.]/g, '').toUpperCase().replace(/^(ภงด|PND|S)/, '');
  if (!t) return null;
  if (t === '53') return 'S53';
  if (t === '3' || t === '03') return 'S03';
  return undefined;
}

/**
 * แฟ้มเอกสารรับ/จ่ายเงิน → เอกสาร (หนึ่งแถว = หนึ่งบรรทัด · ภาษีหัก ณ ที่จ่ายต่อเอกสาร) — cls ไม่ระบุ = ค่าใช้จ่ายอื่น (OE)
 * มัดจำ (บรรทัดเป็นข้อความ): ไม่มีรหัส ต้องมีรายละเอียด (HANDOFF 171)
 */
export function mapExpenseImport(rows: string[][], ys: YearSystem, cls?: string | null): { docs: ExpenseImportDoc[]; errors: ImportIssue[]; cols: ExpenseImportKey[] } {
  const errors: ImportIssue[] = [];
  const COLS = cashImportColumnsFor(cls);
  const ck = CASH_KINDS.find((x) => x.cls === cls) ?? CASH_KINDS.find((x) => x.cls === 'OE')!;
  const textLines = ck.lines === 'text', who = ck.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const h = findHeader(rows, COLS);
  if ('error' in h) return { docs: [], errors: [h.error], cols: [] };
  const { headAt, cols } = h;
  const docs = new Map<string, ExpenseImportDoc>();
  const docNoAt = new Map<string, { ref: string; row: number }>();
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const cell = (k: ExpenseImportKey) => { const i = cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: no, message: m });
    const n0 = errors.length;
    const docNo = cell('doc_no');
    const ref = cell('ref') || docNo, code = cell('code');
    if (!ref) { bad(`ไม่มีเลขที่อ้างอิง (คอลัมน์ "เลขที่อ้างอิง"${cols.has('doc_no') ? ' หรือ "เลขที่เอกสาร"' : ''} ต้องมีทุกแถว)`); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const docNoBad = importDocNoError(docNo);
    if (docNoBad) bad(docNoBad);
    const first = docs.get(ref);
    const date = !cell('date') && first ? first.date : importDate(cell('date'), ys);
    if (!date) bad(`วันที่ "${cell('date')}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    const p = inheritParty(partyCells((k) => cell(k as ExpenseImportKey), bad), first);
    if (p && !p.party && !p.party_name && !p.party_tax_id) bad(`ไม่มีรหัสหรือชื่อ${who}`);
    if (!textLines && !code) bad(ck.itemType === '4' ? 'ไม่มีรหัสรายได้' : 'ไม่มีรหัสค่าใช้จ่าย');
    if (textLines && !cell('description')) bad('ไม่มีรายละเอียด (คอลัมน์ "รายละเอียด" ต้องมีทุกแถว)');
    const amount = importNumber(cell('amount'));
    if (amount === null) bad(`จำนวนเงิน "${cell('amount')}" ไม่ใช่ตัวเลข`);
    else if (Number(amount) === 0) bad('จำนวนเงินเป็น 0');
    const wht = whtCells((k) => cell(k as ExpenseImportKey), bad);
    const refDateT = cell('ref_date'), refDate = refDateT ? importDate(refDateT, ys) : null;
    if (refDateT && !refDate) bad(`วันที่ใบกำกับ "${refDateT}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`);
    if (errors.length > n0 || !p || !date || amount === null) continue;
    const head = { doc_no: docNo || null, remark: cell('remark') || null, ref_no: cell('ref_no').slice(0, 30) || null, ref_date: refDate, department: cell('department') || null, project: cell('project') || null,
      pay_method: cell('pay_method') || null, pay_ref: cell('pay_ref').slice(0, 30) || null };
    let doc = docs.get(ref);
    if (!doc) {
      if (docs.size >= MAX_IMPORT_DOCS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_DOCS} เอกสาร — แบ่งเป็นหลายแฟ้ม`); break; }
      doc = { ref, row: no, ...p, date, wht, ...head, lines: [] };
      docs.set(ref, doc);
    } else {
      const before = errors.length;
      if (doc.date !== date) bad(`เลขที่อ้างอิง ${ref}: วันที่ไม่ตรงกับแถว ${doc.row}`);
      if (errors.length === before) samePartyOrBad(doc, p, bad);
      if (wht && doc.wht && JSON.stringify(wht) !== JSON.stringify(doc.wht)) bad(`เลขที่อ้างอิง ${ref}: ภาษีหัก ณ ที่จ่ายไม่ตรงกับแถว ${doc.row} — ใส่แถวเดียวของเอกสาร`);
      if (head.pay_method && doc.pay_method && head.pay_method !== doc.pay_method) bad(`เลขที่อ้างอิง ${ref}: วิธีชำระไม่ตรงกับแถว ${doc.row} — ใส่แถวเดียว หรือใช้แผ่น "จ่ายชำระ" เมื่อแบ่งหลายวิธี`);
      if (head.doc_no && doc.doc_no && head.doc_no !== doc.doc_no) bad(`เลขที่อ้างอิง ${ref}: เลขที่เอกสาร ${head.doc_no} ไม่ตรงกับแถว ${doc.row} (${doc.doc_no}) — หนึ่งเอกสารใช้เลขที่เดียว`);
      headConflicts(ref, doc, head, ['doc_no', 'pay_method'], (k) => COLS.find((x) => x.key === k)?.th ?? k, bad);
      if (errors.length > before) continue;
      doc.wht ??= wht;
      const d0 = doc as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(head)) if (d0[k] === null || d0[k] === undefined) d0[k] = v;
    }
    if (doc.doc_no) {
      const at = docNoAt.get(doc.doc_no.toUpperCase());
      if (at && at.ref !== ref) { bad(`เลขที่เอกสาร ${doc.doc_no} ซ้ำกับเลขที่อ้างอิง ${at.ref} (แถว ${at.row}) — หนึ่งเลขที่ใช้ได้เอกสารเดียว`); if (doc.lines.length === 0) docs.delete(ref); continue; }
      if (!at) docNoAt.set(doc.doc_no.toUpperCase(), { ref, row: doc.row });
    }
    doc.lines.push({ row: no, code: textLines ? '' : code, description: cell('description') || null, amount, job: cell('line_job') || null });
  }
  if (!docs.size && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { docs: [...docs.values()], errors, cols: [...cols.keys()] };
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
