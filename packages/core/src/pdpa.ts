/**
 * พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) — T0.17
 * ทะเบียนข้อมูลส่วนบุคคล (บันทึกรายการตาม ม.39): ตาราง/ช่องที่เก็บข้อมูลบุคคล ใครเป็นเจ้าของข้อมูล วัตถุประสงค์ ฐานทางกฎหมาย ระยะเก็บ และการลบ
 * การลบตามคำขอ (ม.33) มี 2 ระดับ เพราะกฎหมายบัญชี/ภาษีบังคับเก็บเอกสาร 5 ปี (พ.ร.บ.การบัญชี 2543 ม.14 · ประมวลรัษฎากร ม.87/3):
 *   CONTACT = ลบได้ทันที (ข้อมูลติดต่อที่ไม่อยู่ในเอกสารภาษี)
 *   FULL    = ปิดบังชื่อ ที่อยู่ เลขผู้เสียภาษี ทั้งในแฟ้มหลักและเอกสาร — ได้เมื่อเอกสารล่าสุดพ้นระยะเก็บรักษาแล้ว
 *   PURGE   = ลบเมื่อลูกค้าผู้ใช้บริการเลิกใช้บริการ (ผู้ให้บริการลบทั้งลูกค้า)
 *   KEEP    = เก็บตามกฎหมาย ไม่ลบ (แฟ้มบันทึกเหตุการณ์ — เพิ่มได้อย่างเดียว)
 */
export type PdpaSubject = 'CUSTOMER' | 'SUPPLIER' | 'SALESPERSON' | 'CONTACT' | 'PARTY' | 'USER' | 'TENANT';
export type PdpaBasis = 'CONTRACT' | 'LEGAL' | 'LEGIT';
export type PdpaErase = 'CONTACT' | 'FULL' | 'PURGE' | 'KEEP';
export type PdpaEntry = {
  table: string;
  columns: string[];
  subject: PdpaSubject;
  category: string;
  purpose: string;
  basis: PdpaBasis;
  retention: string;
  erase: PdpaErase;
  /** ผู้ประมวลผลข้อมูลภายนอก/การส่งไปต่างประเทศ (ม.28–29) */
  transfer?: string;
};

export const PDPA_SUBJECT_TH: Record<PdpaSubject, string> = {
  CUSTOMER: 'ลูกค้า', SUPPLIER: 'ผู้จำหน่าย/เจ้าหนี้', SALESPERSON: 'พนักงานขาย', CONTACT: 'ผู้ติดต่อของลูกค้า/ผู้จำหน่าย',
  PARTY: 'คู่ค้าในเอกสาร (ลูกค้า/ผู้จำหน่าย/ผู้ถูกหักภาษี)', USER: 'ผู้ใช้งานโปรแกรม', TENANT: 'ลูกค้าผู้ใช้บริการ/เจ้าของกิจการ',
};
export const PDPA_BASIS_TH: Record<PdpaBasis, string> = {
  CONTRACT: 'จำเป็นเพื่อปฏิบัติตามสัญญา (ม.24(3))', LEGAL: 'ปฏิบัติตามกฎหมายบัญชี/ภาษี (ม.24(6))', LEGIT: 'ประโยชน์โดยชอบด้วยกฎหมาย — ความปลอดภัยของระบบ (ม.24(5))',
};
export const PDPA_ERASE_TH: Record<PdpaErase, string> = {
  CONTACT: 'ลบได้ทันทีเมื่อเจ้าของข้อมูลขอ', FULL: 'ปิดบังได้เมื่อพ้นระยะเก็บเอกสาร 5 ปี', PURGE: 'ลบเมื่อเลิกใช้บริการ', KEEP: 'เก็บตามกฎหมาย ไม่ลบ',
};

const R5 = 'เอกสารล่าสุด + 5 ปีนับจากวันสิ้นปีบัญชี';
const ACTIVE = 'ระหว่างเป็นคู่ค้า (ลบเมื่อเจ้าของข้อมูลขอ)';
const SERVICE = 'ระหว่างใช้บริการ (ลบเมื่อเลิกใช้บริการ + 90 วัน)';

export const PDPA_REGISTER: PdpaEntry[] = [
  { table: 'md_customer', columns: ['title', 'name', 'name_en', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no'], subject: 'CUSTOMER', category: 'ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษี', purpose: 'ออกใบกำกับภาษี/เอกสารขาย ติดตามหนี้', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'md_customer', columns: ['phone', 'email', 'contact', 'remark'], subject: 'CUSTOMER', category: 'ข้อมูลติดต่อ', purpose: 'ติดต่อเรื่องการขาย ส่งของ วางบิล', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_customer_ship_to', columns: ['address_1', 'address_2', 'address_3', 'zip_code'], subject: 'CUSTOMER', category: 'ที่อยู่ส่งของ', purpose: 'จัดส่งสินค้า (พิมพ์ในใบส่งของ)', basis: 'CONTRACT', retention: R5, erase: 'FULL' },
  { table: 'md_customer_ship_to', columns: ['phone', 'contact'], subject: 'CUSTOMER', category: 'ข้อมูลติดต่อ ณ สถานที่ส่ง', purpose: 'จัดส่งสินค้า', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_supplier', columns: ['title', 'name', 'name_en', 'address_1', 'address_2', 'address_3', 'zip_code', 'tax_id', 'tax_branch_no'], subject: 'SUPPLIER', category: 'ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษี', purpose: 'บันทึกซื้อ ภาษีซื้อ ภาษีหัก ณ ที่จ่าย (50 ทวิ)', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'md_supplier', columns: ['phone', 'contact', 'remark'], subject: 'SUPPLIER', category: 'ข้อมูลติดต่อ', purpose: 'ติดต่อเรื่องการซื้อ การจ่ายชำระ', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_supplier_bank', columns: ['account_no', 'account_name', 'branch'], subject: 'SUPPLIER', category: 'บัญชีธนาคาร', purpose: 'โอนจ่ายชำระหนี้', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_party_contact', columns: ['name', 'position', 'phone', 'email'], subject: 'CONTACT', category: 'ชื่อ ตำแหน่ง ข้อมูลติดต่อ', purpose: 'ติดต่อผู้รับผิดชอบของคู่ค้า', basis: 'LEGIT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_note', columns: ['text'], subject: 'CUSTOMER', category: 'หมายเหตุของลูกค้า/ผู้จำหน่าย (อาจมีข้อมูลบุคคล)', purpose: 'บันทึกเพิ่มเติมของผู้ใช้', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'md_salesperson', columns: ['name'], subject: 'SALESPERSON', category: 'ชื่อ', purpose: 'อ้างอิงในเอกสารขาย คำนวณค่าคอมมิชชั่น', basis: 'CONTRACT', retention: R5, erase: 'FULL' },
  { table: 'md_salesperson', columns: ['address', 'zip_code', 'phone', 'tax_id', 'social_security_no'], subject: 'SALESPERSON', category: 'ที่อยู่ เบอร์โทร เลขประจำตัว เลขประกันสังคม', purpose: 'ติดต่อพนักงาน', basis: 'CONTRACT', retention: ACTIVE, erase: 'CONTACT' },
  { table: 'doc_header', columns: ['party_name', 'party_address', 'party_tax_id', 'party_tax_branch_no'], subject: 'PARTY', category: 'ชื่อ ที่อยู่ เลขผู้เสียภาษีบนเอกสาร', purpose: 'หลักฐานทางบัญชี/ใบกำกับภาษี', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'tax_vat_entry', columns: ['party_name', 'party_tax_id', 'party_tax_branch_no'], subject: 'PARTY', category: 'ชื่อ เลขผู้เสียภาษี', purpose: 'รายงานภาษีซื้อ/ภาษีขาย ภ.พ.30', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'tax_wht_entry', columns: ['payee_name', 'payee_address', 'payee_tax_id', 'payee_tax_branch_no'], subject: 'PARTY', category: 'ชื่อ ที่อยู่ เลขผู้เสียภาษีของผู้ถูกหัก', purpose: 'หนังสือรับรอง 50 ทวิ แบบ ภ.ง.ด.3/53', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'fin_cheque', columns: ['payee_name'], subject: 'PARTY', category: 'ชื่อผู้รับเงิน', purpose: 'ทะเบียนเช็ค', basis: 'LEGAL', retention: R5, erase: 'FULL' },
  { table: 'md_serial', columns: ['customer_name'], subject: 'CUSTOMER', category: 'ชื่อลูกค้า (บัตรรับประกัน)', purpose: 'รับประกัน/บริการหลังการขาย', basis: 'CONTRACT', retention: R5, erase: 'FULL' },
  { table: 'sys_ai_usage', columns: ['file_name'], subject: 'PARTY', category: 'ภาพบิลที่ผู้ใช้ส่งให้ AI อ่าน (ชื่อ ที่อยู่ เลขผู้เสียภาษีของผู้ขาย) — ระบบเก็บแค่ชื่อแฟ้ม ไม่เก็บภาพ', purpose: 'อ่านบิลซื้อเป็นเอกสาร (เมื่อผู้ใช้กดอ่านบิลเท่านั้น)', basis: 'CONTRACT', retention: SERVICE, erase: 'PURGE', transfer: 'Anthropic, PBC (สหรัฐอเมริกา) ผ่านกุญแจ API ของลูกค้าเอง' },
  { table: 'sys_user', columns: ['username', 'display_name'], subject: 'USER', category: 'รหัสผู้ใช้ ชื่อ', purpose: 'เข้าระบบ ระบุผู้ทำรายการ', basis: 'CONTRACT', retention: SERVICE, erase: 'PURGE' },
  { table: 'sys_user_security', columns: ['totp_secret_enc', 'totp_recovery'], subject: 'USER', category: 'กุญแจยืนยันตัวตนสองขั้น (เข้ารหัส)', purpose: 'ความปลอดภัยการเข้าระบบ', basis: 'LEGIT', retention: SERVICE, erase: 'PURGE' },
  { table: 'sys_session', columns: ['ip_address', 'user_agent'], subject: 'USER', category: 'IP และเบราว์เซอร์ที่เข้าระบบ', purpose: 'ความปลอดภัยการเข้าระบบ', basis: 'LEGIT', retention: SERVICE, erase: 'PURGE' },
  { table: 'sys_activity_log', columns: ['user_id', 'detail'], subject: 'USER', category: 'ผู้ทำรายการ ค่าก่อน/หลังแก้ไข', purpose: 'ตรวจสอบย้อนหลัง (Audit trail)', basis: 'LEGAL', retention: 'อย่างน้อย 2 ปี (เพิ่มได้อย่างเดียว)', erase: 'KEEP' },
  { table: 'sys_tenant', columns: ['name', 'contact_email', 'contact_phone'], subject: 'TENANT', category: 'ชื่อ ข้อมูลติดต่อผู้ใช้บริการ', purpose: 'ให้บริการและเรียกเก็บค่าบริการ', basis: 'CONTRACT', retention: SERVICE, erase: 'PURGE' },
  { table: 'sys_company_image', columns: ['name', 'data'], subject: 'TENANT', category: 'รูปลายเซ็นผู้มีอำนาจ/ผู้รับเงิน และโลโก้', purpose: 'พิมพ์ในเอกสาร', basis: 'CONTRACT', retention: SERVICE, erase: 'PURGE' },
  { table: 'sys_company', columns: ['name_th', 'name_en', 'address_th', 'address_en', 'phone', 'tax_id', 'social_security_no'], subject: 'TENANT', category: 'ชื่อ ที่อยู่ เลขผู้เสียภาษีของกิจการ (เป็นข้อมูลบุคคลเมื่อเจ้าของเป็นบุคคลธรรมดา)', purpose: 'พิมพ์หัวเอกสาร/แบบยื่นภาษี', basis: 'CONTRACT', retention: SERVICE, erase: 'PURGE' },
];

/**
 * ชื่อช่องที่ถือว่าเป็นข้อมูลบุคคล — ชุดทดสอบตรวจว่าทุกช่องในฐานข้อมูลที่ชื่อตรงแบบนี้อยู่ในทะเบียน (หรือใน PDPA_NOT_PERSONAL)
 * เพิ่มช่องใหม่ที่เก็บข้อมูลบุคคล → ต้องเพิ่มในทะเบียนด้วย
 */
export const PDPA_COLUMN_PATTERN = /^(.*_)?(address(_[a-z0-9]+)?|phone|email|tax_id|social_security_no|contact(_[a-z]+)?|account_no|account_name|payee_name|payee_address|customer_name|party_name|party_address|ip_address|user_agent|display_name|zip_code)$/;
/** ช่องที่ชื่อตรงแบบแต่ไม่ใช่ข้อมูลบุคคล (ตาราง.ช่อง → เหตุผล) */
export const PDPA_NOT_PERSONAL: Record<string, string> = {
  'gl_account.account_no': 'เลขที่บัญชีในผังบัญชี',
  'sys_branch.address': 'ที่อยู่สาขาของกิจการ',
  'md_bank_account.account_no': 'เลขที่บัญชีเงินฝากของกิจการเอง',
  'md_bank_account.account_name': 'ชื่อบัญชีเงินฝากของกิจการเอง',
  'sys_api_key.last_used_ip': 'IP ของระบบที่เชื่อมต่อ',
};

/** ระยะเก็บเอกสารบัญชี/ภาษี (ปี) และระยะผ่อนผันหลังเลิกใช้บริการ (วัน) */
export const PDPA_RETENTION_YEARS = 5;
export const PDPA_GRACE_DAYS = 90;
/** ข้อความแทนชื่อที่ถูกปิดบัง */
export const PDPA_ERASED = 'ลบตาม PDPA';

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/**
 * เก็บเอกสารถึงวันนี้: สิ้นปีบัญชีที่มีเอกสารล่าสุด + 5 ปี (ไม่รู้ปีบัญชี = 31 ธ.ค. ของปีเอกสาร) · ISO yyyy-mm-dd
 * ไม่มีเอกสารเลย = null (ปิดบังได้ทันที)
 */
export function pdpaRetainUntil(lastDocDate: string | null, fiscalYearEnd?: string | null, years = PDPA_RETENTION_YEARS): string | null {
  if (!lastDocDate) return null;
  const base = fiscalYearEnd && fiscalYearEnd >= lastDocDate ? fiscalYearEnd : `${lastDocDate.slice(0, 4)}-12-31`;
  const y = Number(base.slice(0, 4)) + years;
  let md = base.slice(5);
  if (md === '02-29' && !isLeap(y)) md = '02-28';
  return `${y}-${md}`;
}
/** ปิดบังทั้งหมดได้หรือยัง (วันนี้เลยวันที่ต้องเก็บแล้ว) */
export const pdpaCanFullErase = (today: string, retainUntil: string | null) => !retainUntil || today > retainUntil;

/** วันที่ลบข้อมูลลูกค้าผู้ใช้บริการได้ = วันเลิกใช้บริการ + 90 วัน */
export function pdpaPurgeAfter(terminatedOn: string, days = PDPA_GRACE_DAYS): string {
  const d = new Date(`${terminatedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
