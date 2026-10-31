/**
 * การเชื่อมต่อบัญชี (คู่มือบทที่ 10) และประเภทเอกสาร/เลขที่เอกสาร (บทที่ 9)
 * ลำดับการหาบัญชี: 1 บัญชีที่ประเภทเอกสาร (md_doc_type_account) → 2 แฟ้มหลัก (ลูกค้า สินค้า→กลุ่มบัญชี บัญชีเงินฝาก) → 3 บัญชีเพื่อลงรายวัน (gl_default_account)
 */

/** บัญชีเพื่อลงรายวัน (เริ่มระบบ 5.2) — ลำดับและชื่อตามหน้าจอ Express */
export const GL_ROLES: Array<{ role: string; section: string; label: string; hint?: string }> = [
  { role: 'RETAINED_EARNINGS', section: 'ทั่วไป', label: 'บัญชีกำไรสะสม' },
  { role: 'SUSPENSE', section: 'ทั่วไป', label: 'บัญชีพัก', hint: 'ห้ามใช้บันทึกรายการ — ถ้ามียอดแปลว่าการลงบัญชีมีปัญหา' },
  { role: 'CASH', section: 'สินทรัพย์', label: 'เงินสด' },
  { role: 'PETTY_CASH', section: 'สินทรัพย์', label: 'เงินสดย่อย' },
  { role: 'AR', section: 'สินทรัพย์', label: 'ลูกหนี้', hint: 'ใช้เมื่อรายละเอียดลูกค้าไม่ได้กำหนดบัญชี' },
  { role: 'CHEQUE_RECEIVED', section: 'สินทรัพย์', label: 'เช็ครับล่วงหน้า' },
  { role: 'INVENTORY', section: 'สินทรัพย์', label: 'สินค้า' },
  { role: 'PREPAID_TAX', section: 'สินทรัพย์', label: 'ภาษีนิติบุคคลจ่ายล่วงหน้า (ถูกหัก ณ ที่จ่าย)' },
  { role: 'VAT_REFUND', section: 'สินทรัพย์', label: 'ลูกหนี้กรมสรรพากร (ภาษีซื้อมากกว่าภาษีขาย)', hint: 'ใช้ในใบสำคัญปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน' },
  { role: 'INPUT_VAT', section: 'สินทรัพย์', label: 'ภาษีซื้อ' },
  { role: 'INPUT_VAT_PENDING', section: 'สินทรัพย์', label: 'ภาษีซื้อยังไม่ถึงกำหนด' },
  { role: 'INPUT_VAT_PP36', section: 'สินทรัพย์', label: 'ภาษีซื้อรอเครดิต (ภ.พ.36)', hint: 'VAT ที่นำส่งแทนผู้ให้บริการต่างประเทศ (Agoda Booking.com Airbnb ฯลฯ) — เป็นภาษีซื้อเดือนถัดไปตอนปรับปรุงภาษีประจำเดือน' },
  { role: 'WHT_RECOVERABLE', section: 'สินทรัพย์', label: 'ภาษีหัก ณ ที่จ่ายรอเรียกคืนจากผู้ให้บริการ', hint: 'แพลตฟอร์มหักค่าบริการเต็มจำนวน แต่เราหักภาษี ณ ที่จ่ายไว้ — ยอดที่ต้องเรียกคืนจากแพลตฟอร์ม' },
  { role: 'DEPOSIT_PAID', section: 'สินทรัพย์', label: 'เงินมัดจำจ่ายล่วงหน้า' },
  { role: 'AP', section: 'หนี้สิน', label: 'เจ้าหนี้', hint: 'ใช้เมื่อรายละเอียดผู้จำหน่ายไม่ได้กำหนดบัญชี' },
  { role: 'CHEQUE_PAID', section: 'หนี้สิน', label: 'เช็คจ่ายล่วงหน้า' },
  { role: 'WHT_PAYABLE', section: 'หนี้สิน', label: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย' },
  { role: 'PP36_PAYABLE', section: 'หนี้สิน', label: 'ภาษีมูลค่าเพิ่มค้างจ่าย ภ.พ.36', hint: 'ยื่นและชำระภายในวันที่ 7 ของเดือนถัดไป (ยื่นทางอินเทอร์เน็ตวันที่ 15)' },
  { role: 'VAT_PAYABLE', section: 'หนี้สิน', label: 'เจ้าหนี้กรมสรรพากร (ภาษีมูลค่าเพิ่มค้างจ่าย)', hint: 'ใช้ในใบสำคัญปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน' },
  { role: 'OUTPUT_VAT', section: 'หนี้สิน', label: 'ภาษีขาย' },
  { role: 'OUTPUT_VAT_PENDING', section: 'หนี้สิน', label: 'ภาษีขาย-รอเรียกเก็บ' },
  { role: 'DEPOSIT_RECEIVED', section: 'หนี้สิน', label: 'เงินมัดจำรับล่วงหน้า' },
  { role: 'CASH_SALES', section: 'รายได้', label: 'ขายสด' },
  { role: 'CREDIT_SALES', section: 'รายได้', label: 'ขายเชื่อ' },
  { role: 'SALES_RETURN', section: 'รายได้', label: 'รับคืน' },
  { role: 'SALES_DISCOUNT', section: 'รายได้', label: 'ส่วนลดจ่าย' },
  { role: 'INTEREST_INCOME', section: 'รายได้', label: 'ดอกเบี้ยรับ' },
  { role: 'BANK_INCOME', section: 'รายได้', label: 'รายได้ธนาคาร' },
  { role: 'OTHER_INCOME', section: 'รายได้', label: 'รายได้อื่น ๆ' },
  { role: 'FX_GAIN_LOSS', section: 'รายได้', label: 'กำไร(ขาดทุน)จากอัตราแลกเปลี่ยน', hint: 'ใช้เมื่อรับ/จ่ายชำระหนี้ต่างประเทศมีผลต่างอัตราแลกเปลี่ยน' },
  { role: 'COGS', section: 'ค่าใช้จ่าย', label: 'ต้นทุนขาย' },
  { role: 'PURCHASES', section: 'ค่าใช้จ่าย', label: 'ซื้อสินค้า' },
  { role: 'PURCHASE_RETURN', section: 'ค่าใช้จ่าย', label: 'ส่งคืน' },
  { role: 'PURCHASE_DISCOUNT', section: 'ค่าใช้จ่าย', label: 'ส่วนลดรับ' },
  { role: 'INTEREST_EXPENSE', section: 'ค่าใช้จ่าย', label: 'ดอกเบี้ยจ่าย' },
  { role: 'BANK_CHARGE', section: 'ค่าใช้จ่าย', label: 'ค่าใช้จ่ายธนาคาร' },
  { role: 'BAD_DEBT', section: 'ค่าใช้จ่าย', label: 'หนี้สูญ' },
  { role: 'OTHER_EXPENSE', section: 'ค่าใช้จ่าย', label: 'ค่าใช้จ่ายอื่น ๆ' },
  { role: 'INPUT_VAT_NONCLAIM', section: 'ค่าใช้จ่าย', label: 'ภาษีซื้อไม่ขอคืน' },
  { role: 'INPUT_VAT_UNCLAIMABLE', section: 'ค่าใช้จ่าย', label: 'ภาษีซื้อขอคืนไม่ได้' },
];

/** ประเภทรายการ → สมุดรายวัน (เริ่มระบบ 5.1) · main = แสดงบนหน้าจอ Express, ที่เหลือใช้เมื่อประเภทเอกสารไม่ได้กำหนดสมุด */
export const JOURNAL_ROUTES: Array<{ kind: string; label: string; main?: boolean }> = [
  { kind: 'PASS_CHEQUE_PAID', label: 'ผ่านเช็คจ่าย', main: true },
  { kind: 'CHEQUE_EXCESS_EXPENSE', label: 'ตัดเช็คจ่ายเกินเป็นค่าใช้จ่าย', main: true },
  { kind: 'PASS_CHEQUE_RCV', label: 'ผ่านเช็ครับ', main: true },
  { kind: 'CHEQUE_EXCESS_INCOME', label: 'ตัดเช็ครับเกินเป็นรายได้', main: true },
  { kind: 'BAD_DEBT', label: 'ตัดยอดเช็ครับเป็นหนี้สูญ', main: true },
  { kind: 'PETTY_CASH_REIMBURSE', label: 'เบิกชดเชยเงินสดย่อย', main: true },
  { kind: 'DEPRECIATION', label: 'คิดค่าเสื่อมราคา', main: true },
  { kind: 'CASH_SALE', label: 'ขายเงินสด' }, { kind: 'CREDIT_SALE', label: 'ขายเงินเชื่อ' }, { kind: 'SALES_RETURN', label: 'ลดหนี้/รับคืน' },
  { kind: 'AR_DEBIT_NOTE', label: 'เพิ่มหนี้ (ลูกหนี้)' }, { kind: 'AR_DEPOSIT', label: 'รับเงินมัดจำ' }, { kind: 'AR_RECEIPT', label: 'รับชำระหนี้' },
  { kind: 'OTHER_INCOME', label: 'บันทึกรายได้อื่น ๆ' }, { kind: 'CASH_PURCHASE', label: 'ซื้อเงินสด' }, { kind: 'CREDIT_PURCHASE', label: 'ซื้อเงินเชื่อ' },
  { kind: 'PURCHASE_RETURN', label: 'ลดหนี้/ส่งคืน' }, { kind: 'AP_CREDIT_NOTE', label: 'เพิ่มหนี้ (เจ้าหนี้)' }, { kind: 'AP_DEPOSIT', label: 'จ่ายเงินมัดจำ' },
  { kind: 'AP_PAYMENT', label: 'จ่ายชำระหนี้' }, { kind: 'OTHER_EXPENSE', label: 'บันทึกค่าใช้จ่ายอื่น ๆ' }, { kind: 'BANK_MOVEMENT', label: 'รายการเงินฝากธนาคาร' },
  { kind: 'INTERNAL_ISSUE', label: 'เบิกใช้ภายใน' }, { kind: 'STOCK_COUNT_ADJ', label: 'ปรับปรุงสินค้า/ตรวจนับ' }, { kind: 'COST_ADJ', label: 'ปรับปรุงต้นทุนสินค้า' },
];

/** หมวดเอกสาร (ISRUN.DOCTYP) — กำหนดตรรกะของเอกสาร · หมวดเดียวแยกได้หลายประเภท (prefix) */
export const DOC_CLASSES: Record<string, { module: string; label: string }> = {
  QT: { module: 'SO', label: 'ใบเสนอราคา' }, SO: { module: 'SO', label: 'ใบสั่งขาย' }, AI: { module: 'AR', label: 'รับเงินมัดจำ' },
  IV: { module: 'AR', label: 'ขายเงินเชื่อ' }, HS: { module: 'AR', label: 'ขายเงินสด' }, DR: { module: 'AR', label: 'เพิ่มหนี้ (ลูกหนี้)' },
  CN: { module: 'AR', label: 'ลดหนี้/รับคืน' }, OI: { module: 'AR', label: 'บันทึกรายได้อื่น ๆ' }, BS: { module: 'AR', label: 'ใบวางบิล' }, RE: { module: 'AR', label: 'รับชำระหนี้' },
  PO: { module: 'PO', label: 'ใบสั่งซื้อ' }, AE: { module: 'AP', label: 'จ่ายเงินมัดจำ' }, RR: { module: 'AP', label: 'ซื้อเงินเชื่อ' }, HP: { module: 'AP', label: 'ซื้อเงินสด' },
  CP: { module: 'AP', label: 'เพิ่มหนี้ (เจ้าหนี้)' }, DN: { module: 'AP', label: 'ลดหนี้/ส่งคืน' }, OE: { module: 'AP', label: 'บันทึกค่าใช้จ่ายอื่น ๆ' },
  BR: { module: 'AP', label: 'ใบรับวางบิล' }, PS: { module: 'AP', label: 'จ่ายชำระหนี้' },
  OU: { module: 'IC', label: 'เบิกใช้/จ่ายสินค้า' }, RL: { module: 'IC', label: 'โอนย้ายระหว่างคลัง' }, JU: { module: 'IC', label: 'ปรับปรุง/รับสินค้า' }, CA: { module: 'IC', label: 'ปรับปรุงต้นทุนสินค้า' },
  BD: { module: 'BK', label: 'ฝากเงินสด' }, BW: { module: 'BK', label: 'ถอนเงินสด' }, BT: { module: 'BK', label: 'โอนเงินระหว่างธนาคาร' }, BU: { module: 'BK', label: 'รับดอกเบี้ย/รายได้ธนาคาร' },
  BV: { module: 'BK', label: 'จ่ายดอกเบี้ย/ค่าธรรมเนียมธนาคาร' }, BQ: { module: 'BK', label: 'ใบนำฝากเช็ค/ขายลดเช็ค' }, QP: { module: 'BK', label: 'ถอนเงินสดด้วยเช็ค' },
  DP: { module: 'PC', label: 'จ่ายค่าใช้จ่ายจากเงินสดย่อย' }, VR: { module: 'PC', label: 'เบิกชดเชยเงินสดย่อย' },
};
export const MODULE_TH: Record<string, string> = { SO: 'ขาย (ใบเสนอ/สั่งขาย)', AR: 'ขายและลูกหนี้', PO: 'ใบสั่งซื้อ', AP: 'ซื้อและเจ้าหนี้', IC: 'สินค้า', BK: 'เงินฝากธนาคาร', PC: 'เงินสดย่อย', GL: 'บัญชี' };

/**
 * ความหมายของช่องบัญชีที่ประเภทเอกสาร (ISRUN.ACCNUM01–12) ต่างกันตามหมวด — ยืนยันจากใบสำคัญจริงของข้อมูลที่ย้ายมา
 * (tools/express-import/posting_engine.py SLOT_ROLE) · ช่องที่ไม่รู้ความหมายแสดงเป็น "ช่องที่ n"
 */
export const DOC_SLOT_ROLES: Record<string, Record<number, string>> = {
  RR: { 3: 'AP' }, CP: { 3: 'AP' }, DN: { 3: 'AP' }, HP: { 3: 'ROUNDING', 4: 'CASH' },
  RE: { 3: 'ROUNDING', 6: 'ROUNDING' }, PS: { 2: 'ROUNDING', 5: 'ROUNDING' }, AE: { 1: 'DEPOSIT_PAID', 3: 'CASH' }, AI: { 3: 'DEPOSIT_RECEIVED' },
  HS: { 5: 'SALES' }, OU: { 1: 'ISSUE_DEBIT', 2: 'ISSUE_CREDIT' }, JU: { 1: 'ADJ_DEBIT', 2: 'ADJ_CREDIT' }, CA: { 2: 'COST_ADJ' },
  DP: { 1: 'PETTY_CASH' }, VR: { 1: 'PETTY_CASH' },
  BD: { 2: 'CASH' }, BW: { 1: 'CASH' }, QP: { 1: 'CASH' }, BU: { 2: 'BANK_INCOME' }, BV: { 1: 'BANK_EXPENSE' }, BQ: { 2: 'BANK_CHARGE' },
};
export const SLOT_ROLE_TH: Record<string, string> = {
  PETTY_CASH: 'เงินสดย่อย', AP: 'Cr. เจ้าหนี้', ROUNDING: 'ส่วนขาด/เกินการชำระ', CASH: 'เงินสด', DEPOSIT_PAID: 'Dr. เงินมัดจำจ่ายล่วงหน้า', DEPOSIT_RECEIVED: 'Cr. เงินมัดจำรับล่วงหน้า',
  SALES: 'Cr. ขายสินค้า', ISSUE_DEBIT: 'Dr. บัญชีเบิกใช้', ISSUE_CREDIT: 'Cr. บัญชีเบิกใช้', ADJ_DEBIT: 'Dr. บัญชีปรับปรุง', ADJ_CREDIT: 'Cr. บัญชีปรับปรุง',
  COST_ADJ: 'บัญชีปรับปรุงต้นทุน', BANK_INCOME: 'Cr. รายได้ธนาคาร', BANK_EXPENSE: 'Dr. ค่าใช้จ่ายธนาคาร', BANK_CHARGE: 'Dr. ค่าธรรมเนียมธนาคาร',
};
export const slotLabel = (docClass: string, slot: number) => { const r = DOC_SLOT_ROLES[docClass]?.[slot]; return r ? SLOT_ROLE_TH[r] ?? r : `ช่องที่ ${slot}`; };

/** เลขที่เอกสารแบบ Express: prefix + เลข 7 หลัก ไม่มีตัวคั่น ไม่เริ่มใหม่ทุกปี (คู่มือหน้า 151) */
export const DOC_NO_WIDTH = 7;
export function formatDocNo(prefix: string, n: number | bigint | string, width = DOC_NO_WIDTH): string {
  return prefix + String(n).padStart(width, '0');
}
export function checkDocNumbering(prefix: string, next: number | string): string | null {
  if (!/^[A-Z0-9ก-๙]{1,4}$/.test(prefix)) return 'ตัวนำหน้าเลขที่ใช้ตัวอักษร/ตัวเลข 1–4 ตัว ห้ามมีเครื่องหมายคั่น (เช่น IV ไม่ใช่ IV/)';
  const s = String(next);
  if (!/^\d+$/.test(s) || Number(s) < 1) return 'เลขที่ถัดไปต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป';
  if (s.replace(/^0+/, '').length > DOC_NO_WIDTH) return `ส่วนตัวเลขไม่เกิน ${DOC_NO_WIDTH} หลัก (IV1234567 ได้ IV12345678 ไม่ได้)`;
  return null;
}

/** ประเภทเอกสารมาตรฐานสำหรับบริษัทใหม่ (ตามค่าตั้งต้นของ Express) — book = รหัสสมุดรายวัน (00 ทั่วไป 01 จ่าย 02 รับ 03 ขาย 04 ซื้อ) ว่าง = ไม่ลงบัญชี */
export const STANDARD_DOC_TYPES: Array<{ code: string; cls: string; th: string; en: string; book: string | null }> = [
  { code: 'QT', cls: 'QT', th: 'ใบเสนอราคา', en: 'Quotation', book: null }, { code: 'SO', cls: 'SO', th: 'ใบสั่งขาย', en: 'Sales Order', book: null },
  { code: 'AI', cls: 'AI', th: 'รับเงินมัดจำ', en: 'Deposit Receive', book: '02' }, { code: 'IV', cls: 'IV', th: 'ขายเงินเชื่อ', en: 'Credit Sales', book: '03' },
  { code: 'HS', cls: 'HS', th: 'ขายเงินสด', en: 'Cash Sales', book: '03' }, { code: 'DR', cls: 'DR', th: 'ใบเพิ่มหนี้ (ลูกหนี้)', en: 'A/R Debit Note', book: '03' },
  { code: 'SR', cls: 'CN', th: 'ใบลดหนี้/รับคืน', en: 'Sales Returns and Allowances', book: '03' }, { code: 'OI', cls: 'OI', th: 'บันทึกรายได้อื่น ๆ', en: 'Other Income', book: '02' },
  { code: 'BI', cls: 'BS', th: 'ใบวางบิล', en: 'A/R Bill Collection List', book: null }, { code: 'RE', cls: 'RE', th: 'รับชำระหนี้', en: 'A/R Receipt', book: '02' },
  { code: 'PO', cls: 'PO', th: 'ใบสั่งซื้อ', en: 'Purchase Order', book: null }, { code: 'AE', cls: 'AE', th: 'จ่ายเงินมัดจำ', en: 'Deposit Payment', book: '01' },
  { code: 'RR', cls: 'RR', th: 'ซื้อเงินเชื่อ', en: 'Credit Purchase', book: '04' }, { code: 'HP', cls: 'HP', th: 'ซื้อเงินสด', en: 'Cash Purchase', book: '04' },
  { code: 'CP', cls: 'CP', th: 'ใบเพิ่มหนี้ (ของเจ้าหนี้)', en: 'A/P Credit Note', book: '04' }, { code: 'GR', cls: 'DN', th: 'ใบลดหนี้/ส่งคืน', en: 'Purchase Returns and Allowance', book: '04' },
  { code: 'OE', cls: 'OE', th: 'บันทึกค่าใช้จ่ายอื่น ๆ', en: 'Other Expenses', book: '01' }, { code: 'BR', cls: 'BR', th: 'ใบรับวางบิล', en: 'A/P Bill Collection List', book: null },
  { code: 'PS', cls: 'PS', th: 'จ่ายชำระหนี้', en: 'A/P Payment', book: '01' },
  { code: 'OU', cls: 'OU', th: 'เบิกใช้ภายใน', en: 'Internal Issue', book: '00' }, { code: 'RL', cls: 'RL', th: 'โอนย้ายระหว่างคลัง', en: 'Stock Transfer', book: null },
  { code: 'JU', cls: 'JU', th: 'ปรับปรุงเพิ่ม/ลดสินค้า', en: 'Stock Adjustment', book: '00' }, { code: 'CA', cls: 'CA', th: 'เพิ่ม/ลดต้นทุนสินค้า', en: 'Cost Adjustment', book: '00' },
  { code: 'BD', cls: 'BD', th: 'ฝากเงินสดเข้าธนาคาร', en: 'Cash Deposit', book: '00' }, { code: 'BW', cls: 'BW', th: 'ถอนเงินสดจากธนาคาร', en: 'Cash Withdrawal', book: '00' },
  { code: 'BT', cls: 'BT', th: 'โอนเงินระหว่างธนาคาร', en: 'Bank Transfer', book: '00' }, { code: 'BU', cls: 'BU', th: 'รับดอกเบี้ยธนาคาร', en: 'Interest Income', book: '00' },
  { code: 'BC', cls: 'BV', th: 'จ่ายค่าดอกเบี้ย', en: 'Interest Expenses', book: '00' }, { code: 'BV', cls: 'BV', th: 'จ่ายค่าธรรมเนียม', en: 'Bank Charges', book: '00' },
  { code: 'BQ', cls: 'BQ', th: 'ใบนำฝากเช็ค', en: 'Cheque Deposit', book: '00' }, { code: 'SQ', cls: 'BQ', th: 'ใบขายลดเช็ค', en: 'Discounting Cheque', book: '00' },
  { code: 'QP', cls: 'QP', th: 'ถอนเงินสดด้วยเช็ค', en: 'Cash Withdrawal by Cheque', book: '00' },
  { code: 'DP', cls: 'DP', th: 'จ่ายค่าใช้จ่ายจากเงินสดย่อย', en: 'Disbursement from Petty Cash', book: '01' }, { code: 'VR', cls: 'VR', th: 'เบิกชดเชยเงินสดย่อย', en: 'Petty Cash Reimbursement', book: '01' },
];

/**
 * คำอธิบายรายการในสมุดรายวันจากแม่แบบของประเภทเอกสาร เช่น "ขายเชื่อให้ {party.title} {party.name}"
 * ช่องที่ไม่มีค่าเป็นค่าว่าง ช่องว่างซ้ำยุบเหลือหนึ่ง (แบบตัวดำเนินการ - ของ xBase ที่ตัดช่องว่าง)
 */
export function renderJournalDesc(template: string | null | undefined, ctx: Record<string, Record<string, string | null | undefined> | undefined>): string {
  if (!template) return '';
  return template.replace(/\{(\w+)\.(\w+)\}/g, (_, o: string, k: string) => (ctx[o]?.[k] ?? '').toString().trim()).replace(/\s+/g, ' ').trim();
}
