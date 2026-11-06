/**
 * ปุ่ม "ตั้งค่าสำหรับ WTS-Living" (HANDOFF ข้อ 86 · docs/17 B5 · docs/07 "ตั้งค่าสำหรับ WTS-Living")
 * รหัสที่ตกลงกับ WTS-Living — Living "ดึงค่าจาก Buddy" หาด้วยรหัสเหล่านี้ (เปลี่ยนรหัสต้องแก้ทั้งสองโปรแกรม)
 * ตรวจซ้ำด้วยรหัส: มีอยู่แล้ว = ใช้ของเดิม ไม่แก้ ไม่สร้างซ้ำ
 */
export const LIVING_DOC_TYPES = [
  { key: 'iv', code: 'IVL', cls: 'IV', module: 'AR', book: '03', name_th: 'ใบแจ้งหนี้ค่าเช่า/ค่าบริการ (WTS-Living)', name_en: 'Rent and service bill (WTS-Living)', vat_basis: '2', price_type: '2', tax_invoice: false },
  { key: 're', code: 'REL', cls: 'RE', module: 'AR', book: '02', name_th: 'ใบเสร็จรับเงิน/ใบกำกับภาษี (WTS-Living)', name_en: 'Receipt / tax invoice (WTS-Living)', vat_basis: null, price_type: null, tax_invoice: true },
  { key: 'ai', code: 'AIL', cls: 'AI', module: 'AR', book: '02', name_th: 'รับเงินประกันผู้เช่า (WTS-Living)', name_en: 'Tenant deposit received (WTS-Living)', vat_basis: null, price_type: '0', tax_invoice: false },
  { key: 'rd', code: 'RDL', cls: 'RD', module: 'AR', book: '01', name_th: 'คืนเงินประกันผู้เช่า (WTS-Living)', name_en: 'Tenant deposit refund (WTS-Living)', vat_basis: null, price_type: null, tax_invoice: false },
] as const;

/** สมุดรายวันของใบสำคัญที่ Living ส่ง (รับรู้ค่าส่วนกลางรายปี · คืนเงินประกันยกมาแบบเดิม) */
export const LIVING_BOOK = { code: 'LV', prefix: 'LV', name_th: 'สมุดรายวัน WTS-Living', name_en: 'WTS-Living journal' } as const;
/** วิธีรับชำระ "หักเงินประกัน" — บัญชี = เงินประกันผู้เช่า */
export const LIVING_PAYMENT_METHOD = { code: 'LVDP', name_th: 'หักเงินประกัน (WTS-Living)', name_en: 'Deducted from deposit (WTS-Living)' } as const;
/** คำนำหน้ารหัสลูกค้าของผู้เช่า/เจ้าของแปลงที่ Living สร้างใน Buddy (LV<รหัสผู้ติดต่อ>) */
export const LIVING_CUSTOMER_PREFIX = 'LV';

/**
 * บัญชีที่ Living ใช้: หาบัญชีเดิมตามชื่อ (บัญชีย่อยในหมวดเดียวกัน) ก่อน ไม่มี = สร้างเป็นบัญชีย่อยข้างบัญชีหลัก (anchor) ในผังของบริษัท
 * anchor: role = บัญชีตามบทบาท (บัญชีใหม่อยู่ใต้บัญชีคุมเดียวกัน) · control = บัญชีคุมที่ชื่อขึ้นต้นด้วยข้อความนี้ (หาก่อน role)
 */
export type LivingAccountKey = 'deposit' | 'advance' | 'fund' | 'opening' | 'rent' | 'utility' | 'common' | 'service' | 'penalty' | 'damage';
export const LIVING_ACCOUNTS: ReadonlyArray<{ key: LivingAccountKey; name_th: string; name_en: string; group: string; control?: string; role: string }> = [
  { key: 'deposit', name_th: 'เงินประกันผู้เช่า', name_en: 'Tenant deposits', group: '2', control: 'เงินมัดจำรับ', role: 'DEPOSIT_RECEIVED' },
  { key: 'advance', name_th: 'รายได้ค่าส่วนกลางรับล่วงหน้า', name_en: 'Common fees received in advance', group: '2', control: 'รายได้รับล่วงหน้า', role: 'DEPOSIT_RECEIVED' },
  { key: 'fund', name_th: 'เงินกองทุนจากสมาชิก', name_en: 'Members fund', group: '3', role: 'RETAINED_EARNINGS' },
  { key: 'opening', name_th: 'บัญชีพักยอดยกมา', name_en: 'Opening balance clearing', group: '3', role: 'RETAINED_EARNINGS' },
  { key: 'rent', name_th: 'รายได้ค่าเช่า', name_en: 'Rental income', group: '4', control: 'รายได้จากการให้บริการ', role: 'CREDIT_SALES' },
  { key: 'utility', name_th: 'รายได้ค่าน้ำค่าไฟ', name_en: 'Water and electricity income', group: '4', control: 'รายได้จากการให้บริการ', role: 'CREDIT_SALES' },
  { key: 'common', name_th: 'รายได้ค่าส่วนกลาง', name_en: 'Common fee income', group: '4', control: 'รายได้จากการให้บริการ', role: 'CREDIT_SALES' },
  { key: 'service', name_th: 'รายได้ค่าบริการอื่น', name_en: 'Other service income', group: '4', control: 'รายได้จากการให้บริการ', role: 'CREDIT_SALES' },
  { key: 'penalty', name_th: 'รายได้ค่าปรับ', name_en: 'Late payment fees', group: '4', role: 'OTHER_INCOME' },
  { key: 'damage', name_th: 'รายได้ค่าเสียหาย', name_en: 'Damage charges', group: '4', role: 'OTHER_INCOME' },
];

/** รหัสรายได้ (สินค้าบริการ) ต่อชนิดรายการเรียกเก็บของ Living — รหัสตามรูปแบบรหัสสินค้ามาตรฐาน 99-!!!!-!!!!!! */
export const LIVING_ITEMS: ReadonlyArray<{ code: string; name_th: string; name_en: string; vat_code: '0' | '1'; account: LivingAccountKey; charges: readonly string[] }> = [
  { code: '50-LIVR-RENT', name_th: 'ค่าเช่าห้อง', name_en: 'Room rent', vat_code: '0', account: 'rent', charges: ['rent', 'furniture'] },
  { code: '50-LIVR-UTIL', name_th: 'ค่าน้ำค่าไฟ', name_en: 'Water and electricity', vat_code: '1', account: 'utility', charges: ['water', 'elec'] },
  { code: '50-LIVR-COMM', name_th: 'ค่าส่วนกลาง', name_en: 'Common fee', vat_code: '0', account: 'common', charges: ['common'] },
  { code: '50-LIVR-SERV', name_th: 'ค่าบริการอื่น', name_en: 'Other services', vat_code: '0', account: 'service', charges: ['fixed', 'onetime'] },
  { code: '50-LIVR-LATE', name_th: 'ค่าปรับชำระล่าช้า', name_en: 'Late payment fee', vat_code: '0', account: 'penalty', charges: ['penalty'] },
  { code: '50-LIVR-FUND', name_th: 'เงินกองทุนแรกเข้า', name_en: 'Members fund (entry)', vat_code: '0', account: 'fund', charges: ['fund'] },
  { code: '50-LIVR-ADVC', name_th: 'ค่าส่วนกลางรับล่วงหน้า', name_en: 'Common fee in advance', vat_code: '0', account: 'advance', charges: ['advance'] },
  { code: '50-LIVR-DMG', name_th: 'ค่าเสียหาย', name_en: 'Damage charge', vat_code: '0', account: 'damage', charges: ['damage'] },
];

const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * เลขบัญชีย่อยถัดไปใต้บัญชีคุม (ไม่ซ้ำ taken) ตามแบบเลขของบัญชีพี่น้อง:
 *  เพิ่มที่ตำแหน่งตัวเลขสุดท้ายที่ไม่ใช่ 0 ของบัญชีพี่น้องเลขมากสุด (4300-06 → 4300-07 · 4200-50 → 4200-60 · 3200-00 → 3300-00)
 *  ไม่มีบัญชีพี่น้อง = เลขบัญชีคุมที่ตัวเลขหลักสุดท้ายเป็น 1 (2133-00 → 2133-01) · ไม่ได้ = null
 *  เลขที่ได้ต้องขึ้นต้นเหมือนบัญชีคุมถึงตัวเลขสุดท้ายที่ไม่ใช่ 0 (ไม่หลุดออกนอกบัญชีคุม)
 */
export function nextChildAccountNo(parentNo: string, siblings: readonly string[], taken: ReadonlySet<string>): string | null {
  const pos = (no: string) => [...no].map((c, i) => (isDigit(c) ? i : -1)).filter((i) => i >= 0);
  const lastNonZero = (no: string) => { const p = pos(no).filter((i) => no[i] !== '0'); return p.length ? p[p.length - 1]! : -1; };
  const keep = lastNonZero(parentNo);
  const prefix = keep >= 0 ? parentNo.slice(0, keep + 1) : '';
  const inside = (no: string) => no.length === parentNo.length && no.startsWith(prefix) && no !== parentNo;
  const bump = (no: string, at: number): string | null => {
    const chars = [...no];
    // ทดเลขได้ภายในกลุ่มตัวเลขเดียวกัน และไม่ทดเข้าหลักของบัญชีคุม (4300-99 → เต็ม ไม่กลายเป็น 4301-00)
    for (let i = at; i > keep && isDigit(chars[i]!); i--) {
      if (chars[i] !== '9') { chars[i] = String(Number(chars[i]) + 1); return chars.join(''); }
      chars[i] = '0';
    }
    return null;
  };
  const sib = siblings.filter(inside).sort();
  let cur: string | null; let at: number;
  if (sib.length) { cur = sib[sib.length - 1]!; at = lastNonZero(cur); if (at <= keep) return null; }
  else {
    const digits = pos(parentNo);
    if (!digits.length) return null;
    at = digits[digits.length - 1]!;
    if (at <= keep) return null;
    cur = parentNo;
  }
  for (let n = 0; n < 200; n++) {
    cur = bump(cur!, at);
    if (!cur || !inside(cur)) return null;
    if (!taken.has(cur)) return cur;
  }
  return null;
}
