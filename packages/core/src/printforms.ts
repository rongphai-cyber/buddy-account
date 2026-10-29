import { BANK_KINDS, BILL_KINDS, CASH_KINDS, SETTLE_KINDS, STOCK_KINDS, TRADE_KINDS } from './doc-calc.js';

/**
 * แบบฟอร์มพิมพ์เอกสาร (คู่มือบทที่ 25 S-RD-01/02 · บทที่ 3 S-UI-08/10)
 * Express ใช้ภาษารายงาน (ไฟล์ .RPT) — Buddy ใช้แบบฟอร์มที่ปรับได้จากหน้าจอ (หัวเรื่อง คอลัมน์ ช่องลงชื่อ สำเนา ขนาดอักษร)
 * เมนูพิมพ์มีฟอร์ม 1–9 ต่อชนิดเอกสาร: ต้นแบบในโปรแกรม (มีเส้น/ไม่มีเส้น/ครึ่งหน้า/ต่อเนื่อง) + ฟอร์มที่บริษัทกำหนดเองทับหมายเลขเดิมได้
 */
export type PrintBase = 'grid' | 'plain' | 'half' | 'cont';
export type PrintFamily = 'trade' | 'settle' | 'bill' | 'cash' | 'stock' | 'bank' | 'petty' | 'journal';
export interface PrintColumn { key: string; label: string; width: number; align: 'l' | 'r' | 'c'; show: boolean }
export interface PrintLayout {
  title: string; title_en: string;
  /** สำเนาที่พิมพ์ต่อครั้ง เช่น ["ต้นฉบับ", "สำเนา"] — ว่าง = หนึ่งชุดไม่มีคำกำกับ */
  copies: string[];
  font_pt: number;
  columns: PrintColumn[];
  head_fields: string[];
  show_company: boolean; show_party: boolean; show_amount_text: boolean; show_totals: boolean;
  show_payments: boolean; show_notes: boolean; show_journal: boolean;
  signatures: string[];
  footer: string;
  /** จำนวนบรรทัดขั้นต่ำของตาราง (เติมบรรทัดว่างให้แบบฟอร์มสูงเท่ากันทุกใบ) */
  min_rows: number;
}
export interface PrintFormEntry { slot: number; name: string; base: PrintBase; layout: PrintLayout; custom: boolean }

export const PRINT_BASES: Array<{ key: PrintBase; label: string; hint: string }> = [
  { key: 'grid', label: 'มาตรฐาน มีเส้นตาราง (A4)', hint: 'กระดาษ A4 แนวตั้ง มีเส้นตาราง' },
  { key: 'plain', label: 'ไม่มีเส้นตาราง (A4)', hint: 'สำหรับพิมพ์ลงแบบฟอร์มที่พิมพ์เส้นไว้แล้ว' },
  { key: 'half', label: 'ครึ่งหน้า (A5 แนวนอน)', hint: 'ครึ่งหนึ่งของ A4 — เอกสารรายการน้อย' },
  { key: 'cont', label: 'กระดาษต่อเนื่อง 9×11 นิ้ว', hint: 'เครื่องพิมพ์ดอตแมทริกซ์ (Express 12/15 cpi)' },
];
/** ฟอร์มต้นแบบที่ทุกชนิดเอกสารมีเสมอ (หมายเลข 1–4) — บริษัทบันทึกฟอร์มของตัวเองทับหมายเลขนี้หรือเพิ่มหมายเลข 5–9 */
export const BUILTIN_SLOTS: Array<{ slot: number; base: PrintBase }> = [{ slot: 1, base: 'grid' }, { slot: 2, base: 'plain' }, { slot: 3, base: 'half' }, { slot: 4, base: 'cont' }];

const STOCK_CLASSES = new Set<string>(STOCK_KINDS.map((k) => k.cls));
const BANK_CLASSES = new Set<string>([...BANK_KINDS.map((k) => k.cls), 'BQ', 'QP']);
export function printFamily(scope: string): PrintFamily {
  if (scope === 'GL') return 'journal';
  if (TRADE_KINDS.some((k) => k.cls === scope)) return 'trade';
  if (SETTLE_KINDS.some((k) => k.cls === scope)) return 'settle';
  if (BILL_KINDS.some((k) => k.cls === scope)) return 'bill';
  if (CASH_KINDS.some((k) => k.cls === scope)) return 'cash';
  if (STOCK_CLASSES.has(scope)) return 'stock';
  if (BANK_CLASSES.has(scope)) return 'bank';
  if (scope === 'DP' || scope === 'VR') return 'petty';
  return 'trade';
}

/** เมนูสิทธิ์ของเอกสารแต่ละหมวด (ใช้ตรวจสิทธิ์พิมพ์/รับรอง/ดูรายละเอียด) */
export function docMenuOf(docClass: string, isOpening = false): string {
  if (docClass === 'GL') return 'GL.JNL';
  if (isOpening) return ['IV', 'DR', 'CN', 'AI'].includes(docClass) ? 'FI.AR.OB' : ['RR', 'CP', 'DN', 'AE'].includes(docClass) ? 'FI.AP.OB' : 'IC.OB';
  const k = [...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BILL_KINDS].find((x) => x.cls === docClass);
  if (k) return k.menu;
  if (STOCK_CLASSES.has(docClass)) return 'IC.TRN';
  if (docClass === 'BQ' || docClass === 'SQ') return 'FI.BK.DQ';
  if (BANK_CLASSES.has(docClass)) return 'FI.BK.TX';
  if (docClass === 'DP' || docClass === 'VR') return 'GL.PC';
  return 'GL.JNL';
}

/** คอลัมน์ที่เลือกได้ของแต่ละกลุ่มเอกสาร (key ตรงกับข้อมูลบรรทัดที่ API พิมพ์ส่งมา) */
export const PRINT_COLUMNS: Record<PrintFamily, Array<Omit<PrintColumn, 'show'> & { show?: boolean }>> = {
  trade: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'รหัสสินค้า', width: 14, align: 'l' }, { key: 'name', label: 'รายละเอียด', width: 34, align: 'l' },
    { key: 'wh', label: 'คลัง', width: 7, align: 'c', show: false }, { key: 'qty', label: 'จำนวน', width: 9, align: 'r' }, { key: 'unit', label: 'หน่วย', width: 8, align: 'c' },
    { key: 'price', label: 'ราคา/หน่วย', width: 11, align: 'r' }, { key: 'disc', label: 'ส่วนลด', width: 8, align: 'r' }, { key: 'amount', label: 'จำนวนเงิน', width: 13, align: 'r' }],
  settle: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่เอกสาร', width: 18, align: 'l' }, { key: 'ref_date', label: 'ลงวันที่', width: 12, align: 'c' },
    { key: 'due_date', label: 'ครบกำหนด', width: 12, align: 'c' }, { key: 'name', label: 'รายการ', width: 22, align: 'l', show: false }, { key: 'ref_amount', label: 'ยอดตามเอกสาร', width: 15, align: 'r' }, { key: 'amount', label: 'ยอดชำระ', width: 15, align: 'r' }],
  bill: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่เอกสาร', width: 18, align: 'l' }, { key: 'ref_date', label: 'ลงวันที่', width: 13, align: 'c' },
    { key: 'due_date', label: 'ครบกำหนด', width: 13, align: 'c' }, { key: 'name', label: 'รายการ', width: 22, align: 'l', show: false }, { key: 'amount', label: 'จำนวนเงิน', width: 16, align: 'r' }],
  cash: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'รหัส', width: 14, align: 'l' }, { key: 'name', label: 'รายการ', width: 50, align: 'l' },
    { key: 'qty', label: 'จำนวน', width: 9, align: 'r', show: false }, { key: 'amount', label: 'จำนวนเงิน', width: 16, align: 'r' }],
  stock: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'รหัสสินค้า', width: 15, align: 'l' }, { key: 'name', label: 'รายละเอียด', width: 37, align: 'l' },
    { key: 'wh', label: 'คลัง', width: 8, align: 'c' }, { key: 'qty', label: 'จำนวน', width: 10, align: 'r' }, { key: 'unit', label: 'หน่วย', width: 8, align: 'c' },
    { key: 'price', label: 'ต้นทุน/หน่วย', width: 11, align: 'r', show: false }, { key: 'amount', label: 'มูลค่า', width: 13, align: 'r', show: false }],
  bank: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'วิธี/เลขที่', width: 18, align: 'l' }, { key: 'name', label: 'รายการ', width: 50, align: 'l' }, { key: 'amount', label: 'จำนวนเงิน', width: 16, align: 'r' }],
  petty: [{ key: 'no', label: 'ลำดับ', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่บัญชี', width: 14, align: 'l' }, { key: 'name', label: 'รายการ', width: 44, align: 'l' },
    { key: 'dept', label: 'แผนก', width: 8, align: 'c', show: false }, { key: 'amount', label: 'จำนวนเงิน', width: 16, align: 'r' }],
  journal: [{ key: 'code', label: 'เลขที่บัญชี', width: 14, align: 'l' }, { key: 'name', label: 'ชื่อบัญชี / คำอธิบาย', width: 46, align: 'l' }, { key: 'dept', label: 'แผนก', width: 8, align: 'c' },
    { key: 'debit', label: 'เดบิต', width: 15, align: 'r' }, { key: 'credit', label: 'เครดิต', width: 15, align: 'r' }],
};

/** ช่องหัวเอกสารที่เลือกพิมพ์ได้ */
export const PRINT_HEAD_FIELDS: Array<{ key: string; label: string; families?: PrintFamily[] }> = [
  { key: 'due_date', label: 'วันครบกำหนด', families: ['trade', 'bill'] }, { key: 'credit_days', label: 'เครดิต (วัน)', families: ['trade'] },
  { key: 'your_ref', label: 'อ้างอิง', families: ['trade', 'cash', 'settle', 'stock', 'bank', 'petty'] }, { key: 'ref_no', label: 'เลขที่อ้างอิง/ใบกำกับผู้จำหน่าย', families: ['trade', 'cash', 'stock'] },
  { key: 'salesperson', label: 'พนักงานขาย', families: ['trade', 'settle', 'bill'] }, { key: 'department', label: 'แผนก' },
  { key: 'delivery_date', label: 'วันส่ง/รับของ', families: ['trade'] }, { key: 'ship_via', label: 'ขนส่งโดย', families: ['trade'] },
  { key: 'payment_terms', label: 'เงื่อนไขการชำระ', families: ['trade', 'bill'] }, { key: 'appointment_date', label: 'วันนัดชำระ', families: ['bill'] },
  { key: 'warehouse', label: 'คลัง', families: ['stock'] }, { key: 'to_warehouse', label: 'คลังปลายทาง', families: ['stock'] },
  { key: 'bank_account', label: 'บัญชีเงินฝาก', families: ['bank'] }, { key: 'to_bank_account', label: 'โอนเข้าบัญชี', families: ['bank'] },
  { key: 'ref_invoice', label: 'ใบกำกับภาษีเดิม', families: ['trade'] }, { key: 'voucher_no', label: 'เลขที่ใบสำคัญ' }, { key: 'remark', label: 'หมายเหตุ' },
];

const SIGN: Record<PrintFamily, string[]> = {
  trade: ['ผู้รับสินค้า', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม'], settle: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้มีอำนาจลงนาม'], bill: ['ผู้รับวางบิล', 'ผู้วางบิล'],
  cash: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้อนุมัติ'], stock: ['ผู้เบิก', 'ผู้จ่าย', 'ผู้อนุมัติ'], bank: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
  petty: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้อนุมัติ'], journal: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
};
const HEAD: Record<PrintFamily, string[]> = {
  trade: ['due_date', 'your_ref', 'salesperson', 'ref_invoice'], settle: ['your_ref', 'voucher_no'], bill: ['due_date', 'appointment_date'], cash: ['your_ref', 'voucher_no'],
  stock: ['warehouse', 'to_warehouse', 'department'], bank: ['bank_account', 'to_bank_account', 'voucher_no'], petty: ['voucher_no'], journal: ['remark'],
};

/** แบบฟอร์มเริ่มต้นตามต้นแบบ — ใช้เป็นฟอร์มในโปรแกรม และเป็นจุดเริ่มเมื่อสร้างฟอร์มใหม่ */
export function defaultLayout(scope: string, base: PrintBase, title = ''): PrintLayout {
  const fam = printFamily(scope);
  const small = base === 'half';
  return {
    title, title_en: '', copies: fam === 'trade' && !['QT', 'SO', 'PO'].includes(scope) ? ['ต้นฉบับ', 'สำเนา'] : [],
    font_pt: small ? 9 : base === 'cont' ? 11 : 10,
    columns: PRINT_COLUMNS[fam].map((c) => ({ ...c, show: c.show !== false && !(small && (c.key === 'disc' || c.key === 'wh')) })),
    head_fields: HEAD[fam], show_company: base !== 'plain', show_party: fam !== 'journal' && fam !== 'stock' && fam !== 'bank',
    show_amount_text: fam !== 'stock' && fam !== 'journal', show_totals: fam !== 'journal', show_payments: fam === 'settle' || fam === 'cash' || scope === 'HS' || scope === 'HP',
    show_notes: true, show_journal: fam === 'journal', signatures: SIGN[fam], footer: '', min_rows: small ? 0 : base === 'cont' ? 12 : 8,
  };
}

/** ทำความสะอาดแบบฟอร์มที่รับจากหน้าจอ/ฐานข้อมูล: เติมค่าที่ขาด ตัดค่าที่ผิด (ฟอร์มเก่ายังเปิดได้เมื่อโปรแกรมเพิ่มตัวเลือกใหม่) */
export function normalizeLayout(scope: string, base: PrintBase, raw: unknown): PrintLayout {
  const def = defaultLayout(scope, base);
  const x = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PrintLayout, unknown>>;
  const str = (v: unknown, max: number, dflt: string) => (typeof v === 'string' ? v.slice(0, max) : dflt);
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const list = (v: unknown, max: number, dflt: string[]) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, max) : dflt);
  const known = PRINT_COLUMNS[printFamily(scope)];
  const cols = Array.isArray(x.columns) ? (x.columns as Array<Partial<PrintColumn>>).filter((c) => c && known.some((k) => k.key === c.key)) : [];
  // คอลัมน์ตามลำดับที่ผู้ใช้จัด + คอลัมน์ใหม่ที่โปรแกรมเพิ่มภายหลัง (ซ่อนไว้)
  const columns: PrintColumn[] = [...cols.map((c) => {
    const k = known.find((y) => y.key === c.key)!;
    return { key: k.key, label: str(c.label, 40, k.label) || k.label, width: Math.min(80, Math.max(3, Number(c.width) || k.width)), align: c.align === 'l' || c.align === 'r' || c.align === 'c' ? c.align : k.align, show: bool(c.show, true) };
  }), ...known.filter((k) => !cols.some((c) => c.key === k.key)).map((k) => ({ ...k, show: cols.length ? false : k.show !== false }))];
  const fonts = Number(x.font_pt);
  return {
    title: str(x.title, 120, def.title), title_en: str(x.title_en, 120, ''), copies: list(x.copies, 6, def.copies),
    font_pt: Number.isFinite(fonts) && fonts >= 7 && fonts <= 16 ? fonts : def.font_pt, columns,
    head_fields: list(x.head_fields, 12, def.head_fields).filter((k) => PRINT_HEAD_FIELDS.some((f) => f.key === k)),
    show_company: bool(x.show_company, def.show_company), show_party: bool(x.show_party, def.show_party), show_amount_text: bool(x.show_amount_text, def.show_amount_text),
    show_totals: bool(x.show_totals, def.show_totals), show_payments: bool(x.show_payments, def.show_payments), show_notes: bool(x.show_notes, def.show_notes),
    show_journal: bool(x.show_journal, def.show_journal), signatures: list(x.signatures, 4, def.signatures), footer: str(x.footer, 300, ''),
    min_rows: Math.min(40, Math.max(0, Math.trunc(Number(x.min_rows ?? def.min_rows)) || 0)),
  };
}

/** เมนูพิมพ์ของชนิดเอกสาร: ต้นแบบ 1–4 + ฟอร์มของบริษัท (ทับหมายเลขเดียวกัน) เรียงตามหมายเลข */
export function printMenu(scope: string, userForms: Array<{ slot: number; name: string; base: string; layout: unknown; status?: string }>, title = ''): PrintFormEntry[] {
  const out = new Map<number, PrintFormEntry>();
  for (const b of BUILTIN_SLOTS) out.set(b.slot, { slot: b.slot, base: b.base, name: PRINT_BASES.find((x) => x.key === b.base)!.label, layout: defaultLayout(scope, b.base, title), custom: false });
  for (const f of userForms) {
    if (f.status === 'I') { out.delete(f.slot); continue; }
    const base = (PRINT_BASES.some((b) => b.key === f.base) ? f.base : 'grid') as PrintBase;
    const layout = normalizeLayout(scope, base, f.layout);
    out.set(f.slot, { slot: f.slot, base, name: f.name, layout: { ...layout, title: layout.title || title }, custom: true });
  }
  return [...out.values()].sort((a, b) => a.slot - b.slot);
}

/**
 * การรับรองเอกสาร/พิมพ์ซ้ำ (คู่มือ S-UI-11 · กำหนดที่ประเภทเอกสาร/สมุดรายวัน S-DN-01/S-GL-10)
 * approveLevel 0 = ไม่ต้องรับรอง · method 1 = พิมพ์ก่อนรับรอง · 2 = รับรองก่อนพิมพ์ · reprintLevel = ระดับที่พิมพ์ซ้ำได้
 */
export interface ApprovalRule { approveLevel: number; method: string | null; reprintLevel: number }
export interface ApprovalState { printCount: number; approved: boolean; cancelled: boolean }
export function checkPrint(rule: ApprovalRule, s: ApprovalState, userLevel: number, isAdmin = false): string | null {
  if (rule.approveLevel > 0 && rule.method === '2' && !s.approved) return 'เอกสารนี้ต้องรับรองก่อนพิมพ์ — ให้ผู้มีระดับอนุมัติตั้งแต่ ' + rule.approveLevel + ' กดรับรองเอกสาร (Alt+O) ก่อน';
  if (s.printCount > 0 && rule.reprintLevel > 0 && !isAdmin && userLevel < rule.reprintLevel) return `เอกสารนี้พิมพ์ไปแล้ว ${s.printCount} ครั้ง — การพิมพ์ซ้ำต้องใช้ผู้มีระดับอนุมัติตั้งแต่ ${rule.reprintLevel} (ระดับของคุณ ${userLevel})`;
  return null;
}
export function checkApprove(rule: ApprovalRule, s: ApprovalState, userLevel: number, isAdmin = false): string | null {
  if (s.cancelled) return 'เอกสารถูกยกเลิกแล้ว รับรองไม่ได้';
  if (s.approved) return 'เอกสารนี้รับรองแล้ว';
  if (rule.approveLevel <= 0) return 'เอกสารประเภทนี้ไม่ต้องรับรอง — กำหนดได้ที่ "รับรองเอกสาร ต้องขออนุมัติระดับ" ของประเภทเอกสาร/สมุดรายวัน';
  if (!isAdmin && userLevel < rule.approveLevel) return `รับรองเอกสารนี้ต้องใช้ผู้มีระดับอนุมัติตั้งแต่ ${rule.approveLevel} (ระดับของคุณ ${userLevel})`;
  if (rule.method === '1' && s.printCount === 0) return 'ยังไม่ได้พิมพ์เอกสาร — ประเภทเอกสารนี้กำหนดให้พิมพ์ก่อนรับรอง';
  return null;
}
export function checkUnapprove(rule: ApprovalRule, s: ApprovalState, userLevel: number, isAdmin = false): string | null {
  if (!s.approved) return 'เอกสารนี้ยังไม่ได้รับรอง';
  if (!isAdmin && userLevel < Math.max(rule.approveLevel, 1)) return `ยกเลิกการรับรองต้องใช้ผู้มีระดับอนุมัติตั้งแต่ ${Math.max(rule.approveLevel, 1)} (ระดับของคุณ ${userLevel})`;
  return null;
}
