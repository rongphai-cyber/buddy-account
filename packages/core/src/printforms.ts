import { BANK_KINDS, BILL_KINDS, CASH_KINDS, DEPOSIT_REFUND, SETTLE_KINDS, STOCK_KINDS, TRADE_KINDS } from './doc-calc.js';

/**
 * แบบฟอร์มพิมพ์เอกสาร (คู่มือบทที่ 25 S-RD-01/02 · บทที่ 3 S-UI-08/10)
 * Express ใช้ภาษารายงาน (ไฟล์ .RPT) — Buddy ใช้แบบฟอร์มที่ปรับได้จากหน้าจอ (หัวเรื่อง คอลัมน์ ช่องลงชื่อ สำเนา ขนาดอักษร)
 * เมนูพิมพ์มีฟอร์ม 1–9 ต่อชนิดเอกสาร: ต้นแบบในโปรแกรม (มีเส้น/ไม่มีเส้น/ครึ่งหน้า/ต่อเนื่อง) + ฟอร์มที่บริษัทกำหนดเองทับหมายเลขเดิมได้
 */
export type PrintBase = 'pro' | 'grid' | 'plain' | 'half' | 'cont';
export type PrintFamily = 'trade' | 'settle' | 'bill' | 'cash' | 'stock' | 'bank' | 'petty' | 'journal';
/** label_en = หัวคอลัมน์ในแบบฟอร์มภาษาอังกฤษ (HANDOFF 151) */
export interface PrintColumn { key: string; label: string; label_en: string; width: number; align: 'l' | 'r' | 'c'; show: boolean }
export interface PrintLayout {
  title: string; title_en: string;
  /** สำเนาที่พิมพ์ต่อครั้ง เช่น ["ต้นฉบับ", "สำเนา"] — ว่าง = หนึ่งชุดไม่มีคำกำกับ */
  copies: string[];
  /** พิมพ์ซ้ำ (เอกสารเคยพิมพ์แล้ว) = แผ่น "ต้นฉบับ" พิมพ์เป็น "สำเนา" · แบบฟอร์มไม่มีคำกำกับ = กำกับ "สำเนา" (ดู sheetCopies) */
  reprint_copy: boolean;
  font_pt: number;
  columns: PrintColumn[];
  head_fields: string[];
  show_company: boolean; show_party: boolean; show_amount_text: boolean; show_totals: boolean;
  show_payments: boolean; show_notes: boolean; show_journal: boolean;
  signatures: string[];
  footer: string;
  /** จำนวนบรรทัดขั้นต่ำของตาราง (เติมบรรทัดว่างให้แบบฟอร์มสูงเท่ากันทุกใบ) */
  min_rows: number;
  /** โลโก้บริษัทที่หัวเอกสาร (ข้อกำหนดเจ้าของ 30/10/2569) — แสดงเมื่อบริษัทมีโลโก้ · none = ไม่แสดง */
  logo: PrintLogoPos;
  /** ความสูงโลโก้ (มม.) */
  logo_mm: number;
  /** รูปลายเซ็นในช่องลงชื่อแต่ละช่อง (ลำดับเดียวกับ signatures) — รหัสรูปของบริษัท หรือ null = ช่องว่างให้เซ็นมือ */
  signature_images: Array<string | null>;
  /**
   * ใบเสร็จ/ใบสำคัญจ่าย (ข้อกำหนดเจ้าของ 31/10/2569): bills = แสดงเลขที่บิลที่ชำระ · items = แสดงรายการสินค้า/บริการของทุกบิล
   * auto = ใบเสร็จรับเงิน/ใบกำกับภาษี (ภาษีเกณฑ์เงินสด) แสดงรายการสินค้า ที่เหลือแสดงเลขที่บิล
   */
  settle_detail: SettleDetail;
  /**
   * ส่วนหัวเอกสาร (เจ้าของ 19/11/2569 HANDOFF 151): ตำแหน่งชื่อ/ข้อมูลบริษัทและชื่อเอกสาร · ขนาดอักษร (pt) และสี
   * ค่าเริ่มต้น (left/right · 0 · '') = หน้าตาเดิมของต้นแบบ — 0 = ขนาดตามต้นแบบ · '' = สีตามต้นแบบ/ธีมบริษัท
   */
  co_align: PrintAlign; title_align: PrintAlign;
  co_name_pt: number; co_name_color: string;
  co_info_pt: number; co_info_color: string;
  title_pt: number; title_color: string;
  /** ส่วนกลาง: สีแถบหัวตาราง/แถบยอดรวมทั้งสิ้น + สีตัวอักษรบนแถบ · ขนาดอักษร/สีของตัวอักษรในตารางรายการและยอดรวม */
  band_color: string; band_text_color: string;
  body_pt: number; body_color: string;
  /** ภาษาของแบบฟอร์ม: th = ไทย · en = อังกฤษ (หัวข้อ/คำกำกับ/จำนวนเงินตัวอักษร/วันที่ — ข้อมูลที่ผู้ใช้คีย์คงเดิม) */
  lang: PrintLang;
  /** ช่องลงชื่อในแบบฟอร์มภาษาอังกฤษ (ลำดับเดียวกับ signatures) */
  signatures_en: string[];
  /**
   * HANDOFF 152 (เจ้าของ 19/11/2569): ตำแหน่งแนวตั้ง บน/กลาง/ล่าง ของโลโก้ ชื่อบริษัท ชื่อเอกสาร (คู่กับ logo/co_align/title_align = ตาราง 9 ช่อง) · ค่าเริ่มต้น top = หน้าตาเดิม
   * co_name2 = ชื่อบริษัทบรรทัดที่สอง (ฟอร์มไทย = ชื่ออังกฤษ · ฟอร์มอังกฤษ = ชื่อไทย) — 0/'' = ตามที่อยู่บริษัท
   * top_bar = แถบสีบนสุดของต้นแบบมืออาชีพ: '' = สีธีม · #rrggbb · none = ไม่แสดง
   * font = แบบอักษรของแผ่น ('' = ตามต้นแบบ · PRINT_FONTS)
   */
  logo_v: PrintVAlign; co_v: PrintVAlign; title_v: PrintVAlign;
  co_name2_pt: number; co_name2_color: string;
  top_bar: string;
  font: string;
}
export type PrintAlign = 'left' | 'center' | 'right';
export const PRINT_ALIGNS: Array<{ key: PrintAlign; label: string }> = [{ key: 'left', label: 'ซ้าย' }, { key: 'center', label: 'กลาง' }, { key: 'right', label: 'ขวา' }];
export type PrintVAlign = 'top' | 'middle' | 'bottom';
export const PRINT_VALIGNS: Array<{ key: PrintVAlign; label: string }> = [{ key: 'top', label: 'บน' }, { key: 'middle', label: 'กลาง' }, { key: 'bottom', label: 'ล่าง' }];
/** ตำแหน่ง 9 ช่องของส่วนหัว (แนวตั้ง × แนวนอน) — ชื่อที่แสดงในหน้าออกแบบ */
export const PRINT_POS9: Array<{ v: PrintVAlign; h: PrintAlign; label: string }> = [
  { v: 'top', h: 'left', label: 'ซ้ายบน' }, { v: 'top', h: 'center', label: 'กลางบน' }, { v: 'top', h: 'right', label: 'ขวาบน' },
  { v: 'middle', h: 'left', label: 'ซ้ายกลาง' }, { v: 'middle', h: 'center', label: 'กึ่งกลาง' }, { v: 'middle', h: 'right', label: 'ขวากลาง' },
  { v: 'bottom', h: 'left', label: 'ซ้ายล่าง' }, { v: 'bottom', h: 'center', label: 'กลางล่าง' }, { v: 'bottom', h: 'right', label: 'ขวาล่าง' },
];
/**
 * แบบอักษรของแผ่นเอกสาร (HANDOFF 152) — แบบอักษรไทยของ Google Fonts (โหลดเมื่อใช้ · โปรแกรมโหลด IBM Plex Sans Thai และ Sarabun อยู่แล้ว)
 * '' = ตามต้นแบบ (มืออาชีพ = IBM Plex Sans Thai · ต้นแบบอื่น = Sarabun)
 */
export const PRINT_FONTS: Array<{ key: string; label: string }> = [
  { key: '', label: 'ตามต้นแบบ (มืออาชีพ = IBM Plex Sans Thai · อื่น ๆ = Sarabun)' }, { key: 'IBM Plex Sans Thai', label: 'IBM Plex Sans Thai (แบบอักษรของโปรแกรม)' },
  { key: 'Sarabun', label: 'Sarabun (สารบรรณ — แบบหนังสือราชการ)' }, { key: 'Noto Sans Thai', label: 'Noto Sans Thai (อ่านง่าย มีหัว)' },
  { key: 'Prompt', label: 'Prompt (ไม่มีหัว ทันสมัย)' }, { key: 'Kanit', label: 'Kanit (ไม่มีหัว หนา)' },
];
export type PrintLang = 'th' | 'en';
export const PRINT_LANGS: Array<{ key: PrintLang; label: string }> = [{ key: 'th', label: 'ภาษาไทย' }, { key: 'en', label: 'ภาษาอังกฤษ (English)' }];
export type SettleDetail = 'auto' | 'bills' | 'items';
export const SETTLE_DETAILS: Array<{ key: SettleDetail; label: string }> = [
  { key: 'auto', label: 'อัตโนมัติ (ใบกำกับภาษีแสดงรายการสินค้า · ใบเสร็จแสดงเลขที่บิล)' }, { key: 'bills', label: 'แสดงเลขที่บิลที่ชำระ' }, { key: 'items', label: 'แสดงรายการสินค้า/บริการของทุกบิล' },
];
export type PrintLogoPos = 'none' | 'left' | 'center' | 'right';
export const PRINT_LOGO_POS: Array<{ key: PrintLogoPos; label: string }> = [
  { key: 'left', label: 'ซ้าย (หน้าชื่อบริษัท)' }, { key: 'center', label: 'กลางหน้า (เหนือชื่อบริษัท)' }, { key: 'right', label: 'ขวา' }, { key: 'none', label: 'ไม่แสดงโลโก้' },
];
export interface PrintFormEntry { slot: number; name: string; base: PrintBase; layout: PrintLayout; custom: boolean }

export const PRINT_BASES: Array<{ key: PrintBase; label: string; hint: string }> = [
  { key: 'pro', label: 'มืออาชีพ สีตามธีมบริษัท (A4)', hint: 'กระดาษ A4 แนวตั้ง หัวเอกสารและยอดรวมใช้สีธีมของบริษัท (เจ้าของ 04/11/2569: แบบฟอร์มสวยงามแบบมืออาชีพ) — พิมพ์ขาวดำก็อ่านชัด' },
  { key: 'grid', label: 'มาตรฐาน มีเส้นตาราง (A4)', hint: 'กระดาษ A4 แนวตั้ง มีเส้นตาราง' },
  { key: 'plain', label: 'ไม่มีเส้นตาราง (A4)', hint: 'สำหรับพิมพ์ลงแบบฟอร์มที่พิมพ์หัวบริษัทและเส้นไว้แล้ว — จึงไม่พิมพ์ชื่อบริษัทและโลโก้ (ใช้กระดาษเปล่า: แท็บ หัวเอกสาร/สี › ติ๊ก "พิมพ์ส่วนหัวบริษัท")' },
  { key: 'half', label: 'ครึ่งหน้า (A5 แนวนอน)', hint: 'ครึ่งหนึ่งของ A4 — เอกสารรายการน้อย' },
  { key: 'cont', label: 'กระดาษต่อเนื่อง 9×11 นิ้ว', hint: 'เครื่องพิมพ์ดอตแมทริกซ์ (Express 12/15 cpi)' },
];
/**
 * ฟอร์มต้นแบบที่ทุกชนิดเอกสารมีเสมอ (หมายเลข 1–4, 6) — บริษัทบันทึกฟอร์มของตัวเองทับหมายเลขนี้หรือเพิ่มหมายเลข 5–9
 * ฟอร์ม 1 = มืออาชีพ (04/11/2569) · แบบมีเส้นตารางเดิมย้ายไปหมายเลข 6
 */
export const BUILTIN_SLOTS: Array<{ slot: number; base: PrintBase }> = [{ slot: 1, base: 'pro' }, { slot: 2, base: 'plain' }, { slot: 3, base: 'half' }, { slot: 4, base: 'cont' }, { slot: 6, base: 'grid' }];

/** ชื่อประเภทเอกสารแบบทั่วไปของ Express/Buddy (ชื่อใช้ภายใน เช่น "ขายเงินเชื่อ") — พิมพ์แทนด้วยชื่อเอกสารมาตรฐาน */
const GENERIC_TYPE_NAMES: Record<string, string[]> = {
  IV: ['ขายเงินเชื่อ'], HS: ['ขายเงินสด'], CN: ['ใบลดหนี้/รับคืน', 'ลดหนี้/รับคืน'], DR: ['ใบเพิ่มหนี้ (ลูกหนี้)', 'เพิ่มหนี้ (ลูกหนี้)'], AI: ['รับเงินมัดจำ'],
  RD: ['คืนเงินมัดจำ'], RR: ['ซื้อเงินเชื่อ'], HP: ['ซื้อเงินสด'], DN: ['ใบลดหนี้/ส่งคืน', 'ลดหนี้/ส่งคืน'], CP: ['ใบเพิ่มหนี้ (ของเจ้าหนี้)', 'เพิ่มหนี้ (เจ้าหนี้)'], AE: ['จ่ายเงินมัดจำ'],
  RL: ['โอนย้ายระหว่างคลัง'], OU: ['เบิกใช้ภายใน'], JU: ['ปรับปรุงเพิ่ม/ลดสินค้า'],
  QT: ['ใบเสนอราคา'], SO: ['ใบสั่งขาย'], PO: ['ใบสั่งซื้อ'], BS: ['ใบวางบิล'], BR: ['ใบรับวางบิล'],
};
/** ใบคืนเงินมัดจำที่คืนมัดจำมี VAT = ใบลดหนี้ (ประมวลรัษฎากร ม.86/10 — 06/11/2569) */
export const RD_CREDIT_NOTE_TITLE = 'ใบลดหนี้ / ใบคืนเงินมัดจำ';
/** ชื่อเอกสารมาตรฐานที่พิมพ์ (ไทย/อังกฤษ) — vat = เอกสารมีภาษีมูลค่าเพิ่ม (ต้องมีคำว่า "ใบกำกับภาษี" ตามประมวลรัษฎากร ม.86/4) */
const STD_TITLES: Record<string, (vat: boolean) => [string, string]> = {
  IV: (v) => (v ? ['ใบแจ้งหนี้/ใบกำกับภาษี', 'INVOICE / TAX INVOICE'] : ['ใบแจ้งหนี้', 'INVOICE']),
  HS: (v) => (v ? ['ใบเสร็จรับเงิน/ใบกำกับภาษี', 'RECEIPT / TAX INVOICE'] : ['ใบเสร็จรับเงิน', 'RECEIPT']),
  CN: () => ['ใบลดหนี้', 'CREDIT NOTE'], DR: () => ['ใบเพิ่มหนี้', 'DEBIT NOTE'],
  AI: (v) => (v ? ['ใบรับเงินมัดจำ/ใบกำกับภาษี', 'DEPOSIT RECEIPT / TAX INVOICE'] : ['ใบรับเงินมัดจำ', 'DEPOSIT RECEIPT']),
  RR: () => ['ใบรับสินค้า', 'GOODS RECEIPT'], HP: () => ['ใบรับสินค้า (ซื้อเงินสด)', 'GOODS RECEIPT'], DN: () => ['ใบส่งคืนสินค้า', 'GOODS RETURN'],
  CP: () => ['ใบเพิ่มหนี้ (เจ้าหนี้)', 'SUPPLIER DEBIT NOTE'], AE: () => ['ใบจ่ายเงินมัดจำ', 'DEPOSIT PAYMENT'], RD: (v) => (v ? [RD_CREDIT_NOTE_TITLE, 'CREDIT NOTE / DEPOSIT REFUND'] : ['ใบคืนเงินมัดจำ', 'DEPOSIT REFUND']),
  RL: () => ['ใบโอนย้ายสินค้า', 'STOCK TRANSFER'], OU: () => ['ใบเบิกสินค้า', 'STOCK ISSUE'], JU: () => ['ใบปรับปรุงสินค้า', 'STOCK ADJUSTMENT'],
  QT: () => ['ใบเสนอราคา', 'QUOTATION'], SO: () => ['ใบสั่งขาย', 'SALES ORDER'], PO: () => ['ใบสั่งซื้อ', 'PURCHASE ORDER'],
  BS: () => ['ใบวางบิล', 'BILLING NOTE'], BR: () => ['ใบรับวางบิล', 'BILL ACCEPTANCE'],
};
/**
 * ชื่อที่พิมพ์บนเอกสาร: ประเภทเอกสารที่ยังใช้ชื่อทั่วไป (ขายเงินเชื่อ ฯลฯ) → ชื่อเอกสารมาตรฐาน · บริษัทตั้งชื่อเองแล้ว → ใช้ชื่อนั้น
 * (แบบฟอร์มพิมพ์ตั้ง "หัวเรื่อง" ทับได้อีกชั้น)
 */
export function printTitle(scope: string, typeName: string, typeNameEn: string, hasVat: boolean): { th: string; en: string } {
  const std = STD_TITLES[scope];
  const name = typeName.trim();
  if (std && (!name || (GENERIC_TYPE_NAMES[scope] ?? []).includes(name))) { const [th, en] = std(hasVat); return { th, en }; }
  return { th: name, en: typeNameEn.trim() || (std ? std(hasVat)[1] : '') };
}
/** หัวกล่องคู่ค้าในแบบฟอร์ม */
export function printPartyLabel(scope: string): string {
  const k = [...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BILL_KINDS, DEPOSIT_REFUND].find((x) => x.cls === scope);
  return k?.party === 'supplier' ? 'ผู้จำหน่าย' : k ? 'ลูกค้า' : '';
}

const STOCK_CLASSES = new Set<string>(STOCK_KINDS.map((k) => k.cls));
const BANK_CLASSES = new Set<string>([...BANK_KINDS.map((k) => k.cls), 'BQ', 'QP']);
export function printFamily(scope: string): PrintFamily {
  if (scope === 'GL') return 'journal';
  if (TRADE_KINDS.some((k) => k.cls === scope)) return 'trade';
  if (SETTLE_KINDS.some((k) => k.cls === scope)) return 'settle';
  if (BILL_KINDS.some((k) => k.cls === scope)) return 'bill';
  if (CASH_KINDS.some((k) => k.cls === scope) || scope === DEPOSIT_REFUND.cls) return 'cash';
  if (STOCK_CLASSES.has(scope)) return 'stock';
  if (BANK_CLASSES.has(scope)) return 'bank';
  if (scope === 'DP' || scope === 'VR') return 'petty';
  return 'trade';
}

/** เมนูสิทธิ์ของเอกสารแต่ละหมวด (ใช้ตรวจสิทธิ์พิมพ์/รับรอง/ดูรายละเอียด) */
export function docMenuOf(docClass: string, isOpening = false): string {
  if (docClass === 'GL') return 'GL.JNL';
  if (isOpening && docClass === 'AI') return 'FI.AR.DOB';
  if (isOpening) return ['IV', 'DR', 'CN'].includes(docClass) ? 'FI.AR.OB' : ['RR', 'CP', 'DN', 'AE'].includes(docClass) ? 'FI.AP.OB' : 'IC.OB';
  const k = [...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BILL_KINDS, DEPOSIT_REFUND].find((x) => x.cls === docClass);
  if (k) return k.menu;
  if (STOCK_CLASSES.has(docClass)) return 'IC.TRN';
  if (docClass === 'BQ' || docClass === 'SQ') return 'FI.BK.DQ';
  if (BANK_CLASSES.has(docClass)) return 'FI.BK.TX';
  if (docClass === 'DP' || docClass === 'VR') return 'GL.PC';
  return 'GL.JNL';
}

/**
 * หน้าจอของเอกสาร (ข้อกำหนดเจ้าของ: เลขที่เอกสารอ้างอิงในทุกแท็บคลิกเปิดเอกสารนั้นได้)
 * cls = doc_class · opening = เอกสารยกมา · GL = ใบสำคัญ · null = ไม่มีหน้าจอเปิดเอกสารชนิดนี้
 */
export function docPath(docClass: string | null | undefined, id: string, isOpening = false): string | null {
  if (!docClass || !id) return null;
  if (docClass === 'GL') return `/gl/journals/${id}`;
  if (docClass === 'OS') return `/ic/opening/${id}`;
  if (isOpening) return docClass === 'IV' ? `/fi/ar/opening/${id}` : docClass === 'RR' ? `/fi/ap/opening/${id}` : docClass === 'AI' ? `/fi/ar/deposit-opening/${id}` : null;
  if (docClass === 'DP' || docClass === 'VR') return `/fi/petty-cash/${docClass.toLowerCase()}/${id}`;
  if (docClass === 'BQ' || docClass === 'SQ') return `/fi/cheques/slips/${id}`;
  const k = [...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, DEPOSIT_REFUND, ...BILL_KINDS, ...BANK_KINDS, ...STOCK_KINDS].find((x) => x.cls === docClass);
  return k ? `${k.route}/${id}` : null;
}

/** คอลัมน์ที่เลือกได้ของแต่ละกลุ่มเอกสาร (key ตรงกับข้อมูลบรรทัดที่ API พิมพ์ส่งมา) */
export const PRINT_COLUMNS: Record<PrintFamily, Array<Omit<PrintColumn, 'show'> & { show?: boolean }>> = {
  trade: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'รหัสสินค้า', label_en: 'Item Code', width: 14, align: 'l' }, { key: 'name', label: 'รายละเอียด', label_en: 'Description', width: 34, align: 'l' },
    { key: 'wh', label: 'คลัง', label_en: 'WH', width: 7, align: 'c', show: false }, { key: 'qty', label: 'จำนวน', label_en: 'Qty', width: 9, align: 'r' }, { key: 'unit', label: 'หน่วย', label_en: 'Unit', width: 8, align: 'c' },
    { key: 'price', label: 'ราคา/หน่วย', label_en: 'Unit Price', width: 11, align: 'r' }, { key: 'disc', label: 'ส่วนลด', label_en: 'Discount', width: 8, align: 'r' }, { key: 'amount', label: 'จำนวนเงิน', label_en: 'Amount', width: 13, align: 'r' }],
  settle: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่เอกสาร', label_en: 'Document No.', width: 18, align: 'l' }, { key: 'ref_date', label: 'ลงวันที่', label_en: 'Date', width: 12, align: 'c' },
    { key: 'due_date', label: 'ครบกำหนด', label_en: 'Due Date', width: 12, align: 'c' }, { key: 'name', label: 'รายการ', label_en: 'Description', width: 22, align: 'l', show: false }, { key: 'ref_amount', label: 'ยอดตามเอกสาร', label_en: 'Document Amount', width: 15, align: 'r' }, { key: 'amount', label: 'ยอดชำระ', label_en: 'Paid', width: 15, align: 'r' }],
  bill: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่เอกสาร', label_en: 'Document No.', width: 18, align: 'l' }, { key: 'ref_date', label: 'ลงวันที่', label_en: 'Date', width: 13, align: 'c' },
    { key: 'due_date', label: 'ครบกำหนด', label_en: 'Due Date', width: 13, align: 'c' }, { key: 'name', label: 'รายการ', label_en: 'Description', width: 22, align: 'l', show: false }, { key: 'amount', label: 'จำนวนเงิน', label_en: 'Amount', width: 16, align: 'r' }],
  cash: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'รหัส', label_en: 'Code', width: 14, align: 'l' }, { key: 'name', label: 'รายการ', label_en: 'Description', width: 50, align: 'l' },
    { key: 'qty', label: 'จำนวน', label_en: 'Qty', width: 9, align: 'r', show: false }, { key: 'amount', label: 'จำนวนเงิน', label_en: 'Amount', width: 16, align: 'r' }],
  stock: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'รหัสสินค้า', label_en: 'Item Code', width: 15, align: 'l' }, { key: 'name', label: 'รายละเอียด', label_en: 'Description', width: 37, align: 'l' },
    { key: 'wh', label: 'คลัง', label_en: 'WH', width: 8, align: 'c' }, { key: 'qty', label: 'จำนวน', label_en: 'Qty', width: 10, align: 'r' }, { key: 'unit', label: 'หน่วย', label_en: 'Unit', width: 8, align: 'c' },
    { key: 'price', label: 'ต้นทุน/หน่วย', label_en: 'Unit Cost', width: 11, align: 'r', show: false }, { key: 'amount', label: 'มูลค่า', label_en: 'Value', width: 13, align: 'r', show: false }],
  bank: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'วิธี/เลขที่', label_en: 'Method / No.', width: 18, align: 'l' }, { key: 'name', label: 'รายการ', label_en: 'Description', width: 50, align: 'l' }, { key: 'amount', label: 'จำนวนเงิน', label_en: 'Amount', width: 16, align: 'r' }],
  petty: [{ key: 'no', label: 'ลำดับ', label_en: 'No.', width: 6, align: 'c' }, { key: 'code', label: 'เลขที่บัญชี', label_en: 'Account No.', width: 14, align: 'l' }, { key: 'name', label: 'รายการ', label_en: 'Description', width: 44, align: 'l' },
    { key: 'dept', label: 'แผนก', label_en: 'Dept.', width: 8, align: 'c', show: false }, { key: 'amount', label: 'จำนวนเงิน', label_en: 'Amount', width: 16, align: 'r' }],
  journal: [{ key: 'code', label: 'เลขที่บัญชี', label_en: 'Account No.', width: 14, align: 'l' }, { key: 'name', label: 'ชื่อบัญชี / คำอธิบาย', label_en: 'Account / Description', width: 46, align: 'l' }, { key: 'dept', label: 'แผนก', label_en: 'Dept.', width: 8, align: 'c' },
    { key: 'debit', label: 'เดบิต', label_en: 'Debit', width: 15, align: 'r' }, { key: 'credit', label: 'เครดิต', label_en: 'Credit', width: 15, align: 'r' }],
};

/** ช่องหัวเอกสารที่เลือกพิมพ์ได้ */
export const PRINT_HEAD_FIELDS: Array<{ key: string; label: string; label_en: string; families?: PrintFamily[] }> = [
  { key: 'due_date', label: 'วันครบกำหนด', label_en: 'Due Date', families: ['trade', 'bill'] }, { key: 'credit_days', label: 'เครดิต (วัน)', label_en: 'Credit (days)', families: ['trade'] },
  { key: 'your_ref', label: 'อ้างอิง', label_en: 'Reference', families: ['trade', 'cash', 'settle', 'stock', 'bank', 'petty'] }, { key: 'ref_no', label: 'เลขที่อ้างอิง/ใบกำกับผู้จำหน่าย', label_en: 'Ref. / Supplier Invoice', families: ['trade', 'cash', 'stock'] },
  { key: 'salesperson', label: 'พนักงานขาย', label_en: 'Salesperson', families: ['trade', 'settle', 'bill'] }, { key: 'department', label: 'แผนก', label_en: 'Department' },
  { key: 'delivery_date', label: 'วันส่ง/รับของ', label_en: 'Delivery Date', families: ['trade'] }, { key: 'ship_via', label: 'ขนส่งโดย', label_en: 'Ship Via', families: ['trade'] },
  { key: 'payment_terms', label: 'เงื่อนไขการชำระ', label_en: 'Payment Terms', families: ['trade', 'bill'] }, { key: 'appointment_date', label: 'วันนัดชำระ', label_en: 'Payment Appointment', families: ['bill'] },
  { key: 'warehouse', label: 'คลัง', label_en: 'Warehouse', families: ['stock'] }, { key: 'to_warehouse', label: 'คลังปลายทาง', label_en: 'To Warehouse', families: ['stock'] },
  { key: 'bank_account', label: 'บัญชีเงินฝาก', label_en: 'Bank Account', families: ['bank'] }, { key: 'to_bank_account', label: 'โอนเข้าบัญชี', label_en: 'To Account', families: ['bank'] },
  { key: 'ref_invoice', label: 'ใบกำกับภาษีเดิม', label_en: 'Original Tax Invoice', families: ['trade'] }, { key: 'payment_date', label: 'วันที่รับ/จ่ายเงิน', label_en: 'Payment Date', families: ['settle'] }, { key: 'voucher_no', label: 'เลขที่ใบสำคัญ', label_en: 'Voucher No.' }, { key: 'remark', label: 'หมายเหตุ', label_en: 'Remarks' },
];

const SIGN: Record<PrintFamily, string[]> = {
  trade: ['ผู้รับสินค้า', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม'], settle: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้มีอำนาจลงนาม'], bill: ['ผู้รับวางบิล', 'ผู้วางบิล'],
  cash: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้อนุมัติ'], stock: ['ผู้เบิก', 'ผู้จ่าย', 'ผู้อนุมัติ'], bank: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
  petty: ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้อนุมัติ'], journal: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
};
const SIGN_EN: Record<PrintFamily, string[]> = {
  trade: ['Received by', 'Delivered by', 'Authorized Signature'], settle: ['Received by', 'Paid by', 'Authorized Signature'], bill: ['Bill Received by', 'Billed by'],
  cash: ['Received by', 'Paid by', 'Approved by'], stock: ['Requested by', 'Issued by', 'Approved by'], bank: ['Prepared by', 'Checked by', 'Approved by'],
  petty: ['Received by', 'Paid by', 'Approved by'], journal: ['Prepared by', 'Checked by', 'Approved by'],
};
const HEAD: Record<PrintFamily, string[]> = {
  trade: ['due_date', 'your_ref', 'salesperson', 'ref_invoice'], settle: ['payment_date', 'your_ref', 'voucher_no'], bill: ['due_date', 'appointment_date'], cash: ['your_ref', 'voucher_no'],
  stock: ['warehouse', 'to_warehouse', 'department'], bank: ['bank_account', 'to_bank_account', 'voucher_no'], petty: ['voucher_no'], journal: ['remark'],
};

/** แบบฟอร์มเริ่มต้นตามต้นแบบ — ใช้เป็นฟอร์มในโปรแกรม และเป็นจุดเริ่มเมื่อสร้างฟอร์มใหม่ */
export function defaultLayout(scope: string, base: PrintBase, title = ''): PrintLayout {
  const fam = printFamily(scope);
  const small = base === 'half';
  // มืออาชีพ: รหัสสินค้ากว้างพอไม่ตัดบรรทัด · ไม่เติมบรรทัดว่าง (ไม่มีเส้นแนวตั้ง)
  const proW: Record<string, number> = base === 'pro' ? { code: 17, name: 29, unit: 10 } : {};
  return {
    title, title_en: '', copies: fam === 'trade' && !['QT', 'SO', 'PO'].includes(scope) ? ['ต้นฉบับ', 'สำเนา'] : [], reprint_copy: true,
    font_pt: small ? 9 : base === 'cont' ? 11 : 10,
    columns: PRINT_COLUMNS[fam].map((c) => ({ ...c, width: proW[c.key] ?? c.width, show: c.show !== false && !(small && (c.key === 'disc' || c.key === 'wh')) })),
    // ขายสด/ซื้อสด ไม่มีวันครบกำหนด
    head_fields: scope === 'HS' || scope === 'HP' ? HEAD[fam].filter((k) => k !== 'due_date') : HEAD[fam], show_company: base !== 'plain', show_party: fam !== 'journal' && fam !== 'stock' && fam !== 'bank',
    show_amount_text: fam !== 'stock' && fam !== 'journal', show_totals: fam !== 'journal', show_payments: fam === 'settle' || fam === 'cash' || scope === 'HS' || scope === 'HP',
    show_notes: true, show_journal: fam === 'journal', signatures: SIGN[fam], footer: '', min_rows: small || base === 'pro' ? 0 : base === 'cont' ? 12 : 8,
    // แบบไม่มีเส้น (พิมพ์ลงกระดาษที่มีหัวแล้ว) และกระดาษต่อเนื่อง ไม่พิมพ์โลโก้
    logo: base === 'plain' || base === 'cont' ? 'none' : 'left', logo_mm: base === 'half' ? 12 : 18, signature_images: [], settle_detail: 'auto',
    co_align: 'left', title_align: 'right', co_name_pt: 0, co_name_color: '', co_info_pt: 0, co_info_color: '', title_pt: 0, title_color: '',
    band_color: '', band_text_color: '', body_pt: 0, body_color: '', lang: 'th', signatures_en: SIGN_EN[fam],
    logo_v: 'top', co_v: 'top', title_v: 'top', co_name2_pt: 0, co_name2_color: '', top_bar: '', font: '',
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
    return { key: k.key, label: str(c.label, 40, k.label) || k.label, label_en: str(c.label_en, 40, k.label_en).trim() || k.label_en, width: Math.min(80, Math.max(3, Number(c.width) || k.width)), align: c.align === 'l' || c.align === 'r' || c.align === 'c' ? c.align : k.align, show: bool(c.show, true) };
  }), ...known.filter((k) => !cols.some((c) => c.key === k.key)).map((k) => ({ ...k, show: cols.length ? false : k.show !== false }))];
  const fonts = Number(x.font_pt);
  // ขนาดอักษรเฉพาะส่วน: 0 = ตามต้นแบบ · 6–40 pt (ทีละครึ่ง) · สี: #rrggbb หรือ '' = ตามต้นแบบ
  const pt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 6 && n <= 40 ? Math.round(n * 2) / 2 : 0; };
  const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '');
  const align = (v: unknown, dflt: PrintAlign) => (PRINT_ALIGNS.some((a) => a.key === v) ? (v as PrintAlign) : dflt);
  const valign = (v: unknown): PrintVAlign => (PRINT_VALIGNS.some((a) => a.key === v) ? (v as PrintVAlign) : 'top');
  return {
    title: str(x.title, 120, def.title), title_en: str(x.title_en, 120, ''), copies: list(x.copies, 6, def.copies), reprint_copy: bool(x.reprint_copy, def.reprint_copy),
    font_pt: Number.isFinite(fonts) && fonts >= 7 && fonts <= 16 ? fonts : def.font_pt, columns,
    head_fields: list(x.head_fields, 12, def.head_fields).filter((k) => PRINT_HEAD_FIELDS.some((f) => f.key === k)),
    show_company: bool(x.show_company, def.show_company), show_party: bool(x.show_party, def.show_party), show_amount_text: bool(x.show_amount_text, def.show_amount_text),
    show_totals: bool(x.show_totals, def.show_totals), show_payments: bool(x.show_payments, def.show_payments), show_notes: bool(x.show_notes, def.show_notes),
    show_journal: bool(x.show_journal, def.show_journal), signatures: list(x.signatures, 4, def.signatures), footer: str(x.footer, 300, ''),
    min_rows: Math.min(40, Math.max(0, Math.trunc(Number(x.min_rows ?? def.min_rows)) || 0)),
    logo: PRINT_LOGO_POS.some((p) => p.key === x.logo) ? (x.logo as PrintLogoPos) : def.logo,
    logo_mm: Number.isFinite(Number(x.logo_mm)) ? Math.min(40, Math.max(6, Number(x.logo_mm))) : def.logo_mm,
    signature_images: (Array.isArray(x.signature_images) ? x.signature_images : []).slice(0, 4).map((v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)),
    settle_detail: SETTLE_DETAILS.some((o) => o.key === x.settle_detail) ? (x.settle_detail as SettleDetail) : def.settle_detail,
    co_align: align(x.co_align, def.co_align), title_align: align(x.title_align, def.title_align),
    co_name_pt: pt(x.co_name_pt), co_name_color: color(x.co_name_color), co_info_pt: pt(x.co_info_pt), co_info_color: color(x.co_info_color),
    title_pt: pt(x.title_pt), title_color: color(x.title_color), band_color: color(x.band_color), band_text_color: color(x.band_text_color),
    body_pt: pt(x.body_pt), body_color: color(x.body_color), lang: x.lang === 'en' ? 'en' : 'th',
    signatures_en: Array.isArray(x.signatures_en) ? (x.signatures_en as unknown[]).slice(0, 4).map((v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '')) : def.signatures_en,
    logo_v: valign(x.logo_v), co_v: valign(x.co_v), title_v: valign(x.title_v),
    co_name2_pt: pt(x.co_name2_pt), co_name2_color: color(x.co_name2_color),
    top_bar: x.top_bar === 'none' ? 'none' : color(x.top_bar),
    font: PRINT_FONTS.some((f) => f.key === x.font) ? (x.font as string) : '',
  };
}

/** คำกำกับของเอกสารที่พิมพ์ครั้งแรก / พิมพ์ซ้ำ (ใช้ทั้งหน้าพิมพ์ของ Buddy และ API พิมพ์ให้ระบบอื่น) */
export const COPY_ORIGINAL = 'ต้นฉบับ';
export const COPY_DUPLICATE = 'สำเนา';
/** คำกำกับของการพิมพ์ครั้งนี้ — priorPrints = จำนวนครั้งที่พิมพ์ออกเครื่องพิมพ์ไปแล้วก่อนครั้งนี้ */
export function copyMark(priorPrints: number): string { return priorPrints > 0 ? COPY_DUPLICATE : COPY_ORIGINAL; }
/**
 * แผ่นที่พิมพ์ (หนึ่งแผ่นต่อคำกำกับ · '' = ไม่มีคำกำกับ) — เจ้าของ: ต้นฉบับออกได้ครั้งเดียว (ใบกำกับภาษี ม.86/4 · ฉบับจริงหายต้องออก "ใบแทน" ไม่ใช่พิมพ์ต้นฉบับซ้ำ)
 * - ครั้งแรก = ตามแบบฟอร์ม
 * - พิมพ์ซ้ำ + reprint_copy: คำว่า "ต้นฉบับ" ในคำกำกับ → "สำเนา" (จำนวนแผ่นเท่าเดิม เช่น ต้นฉบับ (ลูกค้า) → สำเนา (ลูกค้า)) · แบบฟอร์มไม่มีคำกำกับ → "สำเนา"
 * - reprint_copy ปิด = ตามแบบฟอร์มทุกครั้ง (เช่น ใบสำคัญภายในที่ไม่ต้องแยก)
 */
export function sheetCopies(layout: Pick<PrintLayout, 'copies' | 'reprint_copy'>, priorPrints: number): string[] {
  const base = layout.copies.length ? layout.copies : [''];
  if (priorPrints <= 0 || !layout.reprint_copy) return base;
  return base.map((c) => (!c ? COPY_DUPLICATE : c.split(COPY_ORIGINAL).join(COPY_DUPLICATE)));
}

/** เมนูพิมพ์ของชนิดเอกสาร: ต้นแบบ 1–4 + ฟอร์มของบริษัท (ทับหมายเลขเดียวกัน) เรียงตามหมายเลข */
export function printMenu(scope: string, userForms: Array<{ slot: number; name: string; base: string; layout: unknown; status?: string }>, title = ''): PrintFormEntry[] {
  const out = new Map<number, PrintFormEntry>();
  for (const b of BUILTIN_SLOTS) out.set(b.slot, { slot: b.slot, base: b.base, name: PRINT_BASES.find((x) => x.key === b.base)!.label, layout: defaultLayout(scope, b.base, title), custom: false });
  // ใบเสร็จ/ใบสำคัญจ่าย: ต้นแบบที่ 5 แสดงรายการสินค้า/บริการของทุกบิลที่ชำระ (ข้อกำหนดเจ้าของ 31/10/2569)
  if (printFamily(scope) === 'settle') out.set(5, { slot: 5, base: 'pro', name: 'มืออาชีพ แสดงรายการสินค้า/บริการของบิล (A4)', layout: { ...defaultLayout(scope, 'pro', title), settle_detail: 'items' }, custom: false });
  for (const f of userForms) {
    if (f.status === 'I') { out.delete(f.slot); continue; }
    const base = (PRINT_BASES.some((b) => b.key === f.base) ? f.base : 'pro') as PrintBase;
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

/**
 * คำบนแบบฟอร์มภาษาอังกฤษ (HANDOFF 151) — คำกำกับที่โปรแกรมพิมพ์เอง (ข้อมูลที่ผู้ใช้คีย์ไม่แปล)
 * ยอดรวม: server ส่ง label_en มาด้วย · ที่นี่เป็นคำของแผ่นเอกสาร
 */
export const PRINT_WORDS_EN = {
  no: 'No.', date: 'Date', tel: 'Tel.', taxId: 'Tax ID', remarks: 'Remarks', total: 'Total', cancelled: 'CANCELLED', signDate: 'Date ......../......../........',
  accountNo: 'Account No.', accountName: 'Account Name', debit: 'Debit', credit: 'Credit', customer: 'Customer', supplier: 'Supplier',
} as const;
/** คำกำกับสำเนา/สาขา (ต้นฉบับ → ORIGINAL · สำเนา → COPY · สำนักงานใหญ่ → Head Office · สาขาที่ n → Branch n) */
export function printTextEn(th: string): string {
  return th.split(COPY_ORIGINAL).join('ORIGINAL').split(COPY_DUPLICATE).join('COPY').replace('สำนักงานใหญ่', 'Head Office').replace(/สาขาที่\s*/, 'Branch ');
}

/** คำของยอดรวม/วิธีชำระที่ระบบพิมพ์ → อังกฤษ (ลำดับสำคัญ: คำที่ยาวกว่า/เฉพาะกว่าก่อน) */
const LABEL_EN: Array<[RegExp, string]> = [
  [/^จำนวนเงินรวมทั้งสิ้น$/, 'Grand Total'], [/^รวมเงินคืนทั้งสิ้น$/, 'Total Refund'], [/^รวมทั้งสิ้น$/, 'Grand Total'], [/^รวมยอดชำระ$/, 'Total Paid'], [/^รวมมูลค่า$/, 'Total Value'],
  [/^รวมเงิน$/, 'Subtotal'], [/^รวม$/, 'Total'], [/^ยอดสุทธิ$/, 'Net Amount'], [/^หลังหักส่วนลด$/, 'After Discount'], [/^ส่วนลดเงินสด$/, 'Cash Discount'],
  [/^ส่วนลด\s*(.*)$/, 'Discount $1'], [/^หักเงินมัดจำ$/, 'Less Deposit'], [/^หักค่าบริการแพลตฟอร์ม$/, 'Less Platform Fees'],
  [/^มูลค่าสินค้า\/บริการที่มีภาษีมูลค่าเพิ่ม$/, 'Value Subject to VAT'], [/^มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม$/, 'Non-VAT Value'], [/^มูลค่าสินค้า\/บริการ$/, 'Value of Goods/Services'],
  [/^มูลค่าก่อนภาษี$/, 'Amount before VAT'], [/^ภาษีมูลค่าเพิ่มของผลต่าง\s*(.*)$/, 'VAT on Difference $1'], [/^ภาษีมูลค่าเพิ่ม\s*(.*)$/, 'VAT $1'],
  [/^ภาษีหัก ณ ที่จ่าย$/, 'Withholding Tax'], [/^มูลค่าสินค้าตามใบกำกับเดิม$/, 'Original Invoice Value'], [/^มูลค่าตามใบกำกับภาษีเดิม$/, 'Original Tax Invoice Value'],
  [/^ลดหนี้ครั้งก่อน$/, 'Previous Credit Notes'], [/^มูลค่าที่ถูกต้อง$/, 'Correct Value'], [/^ผลต่าง$/, 'Difference'], [/^ดอกเบี้ย$/, 'Interest'],
  [/^กำไรจากอัตราแลกเปลี่ยน$/, 'Exchange Gain'], [/^ขาดทุนจากอัตราแลกเปลี่ยน$/, 'Exchange Loss'],
];
/** คำกำกับยอดรวม/วิธีชำระของระบบเป็นภาษาอังกฤษ — คำที่ไม่รู้จัก (ผู้ใช้ตั้งเอง) คงเดิม */
export function printLabelEn(th: string): string {
  const t = th.trim();
  for (const [re, en] of LABEL_EN) if (re.test(t)) return t.replace(re, en).trim();
  return th;
}
