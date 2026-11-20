/**
 * ข้อมูลตั้งต้นของบริษัทใหม่ตามประเภทธุรกิจ (HANDOFF 160 · เจ้าของ 20/11/2569 "ตอนสร้างบริษัทใหม่ ขอสร้างรหัสเริ่มต้นให้กับลูกค้าครั้งแรก
 * เหมือนกับผังบัญชี ให้เลือก … ซึ่งลูกค้าสามารถเปลี่ยนแปลง หรือลบเองได้ … หรือโปรแกรมสร้างต้นแบบธุรกิจขึ้นมาเพื่อให้เลือก เช่น ซื้อมาขาย บริการ ผลิต")
 * ข้อมูลล้วน (ไม่ขึ้นกับฐานข้อมูล) — server/starter.ts ใส่ลงตาราง เฉพาะรหัสที่ยังไม่มี ไม่แก้แถวเดิม · บัญชีอ้างด้วยเลขที่บัญชีของผังมาตรฐาน (ไม่มีในผัง = ว่าง)
 * มีอยู่แล้วในบริษัทใหม่ทุกแบบ: ผังบัญชี สมุดรายวัน รอบบัญชี สำนักงานใหญ่ ประเภทเอกสาร (เลขที่เอกสาร) กฎการลงบัญชี (การเชื่อมต่อบัญชี) ตาราง 70–76
 */
export type StarterKey = 'TRADE' | 'SERVICE' | 'MFG' | 'BLANK';
export const STARTER_TEMPLATES: Array<{ key: StarterKey; th: string; en: string; hint: string }> = [
  { key: 'TRADE', th: 'ซื้อมาขายไป', en: 'Trading', hint: 'ร้านค้า ตัวแทนจำหน่าย ขายส่ง/ขายปลีก — หน่วยนับสินค้า คลังสินค้า สนญ. กลุ่มบัญชีสินค้าซื้อมาขายไป' },
  { key: 'SERVICE', th: 'บริการ', en: 'Service', hint: 'งานบริการ ที่ปรึกษา ซ่อมบำรุง — หน่วยนับงาน/ครั้ง/ชั่วโมง กลุ่มบัญชีงานบริการ ภาษีขายบริการเกณฑ์เงินสด' },
  { key: 'MFG', th: 'ผลิต', en: 'Manufacturing', hint: 'ผลิตแล้วขาย — คลังวัตถุดิบ/งานระหว่างผลิต/สินค้าสำเร็จรูป กลุ่มบัญชีวัตถุดิบ งานระหว่างทำ สินค้าสำเร็จรูป' },
  { key: 'BLANK', th: 'ว่าง (ตั้งเอง)', en: 'Blank (set up yourself)', hint: 'ไม่ใส่ข้อมูลตั้งต้น — มีเฉพาะผังบัญชี เลขที่เอกสาร และการเชื่อมต่อบัญชี' },
];
export const isStarterKey = (v: unknown): v is StarterKey => STARTER_TEMPLATES.some((t) => t.key === v);

type Named = { code: string; th: string; en: string };
export interface StarterData {
  units: Array<Named & { rate?: number }>;
  warehouses: Named[];
  banks: Named[];
  departments: Named[];
  lookups: Array<{ type: string; rows: Named[] }>;
  itemGroups: Array<Named & { cost?: 'A' | 'F'; item_specific?: boolean; inventory?: string; cogs?: string; sales?: string; sales_return?: string; purchase?: string; purchase_return?: string }>;
  assetGroups: Array<Named & { asset: string; expense: string; accum: string }>;
  /** วิธีรับ/จ่ายชำระที่ไม่ต้องมีบัญชีเงินฝากของกิจการ (โอน/เช็คจ่ายต้องเลือกบัญชีเงินฝาก — ตั้งเองหลังเพิ่มบัญชีเงินฝาก) */
  paymentMethods: Array<Named & { direction: 'R' | 'P'; seq: string; kind: 'CASH' | 'CHEQUE' | 'CARD'; account: string; cheque?: boolean }>;
  /** ค่าเริ่มต้นแต่ละระบบ — ใส่เฉพาะที่บริษัทยังไม่ได้ตั้งเอง */
  settings: Record<string, unknown>;
}

const n = (code: string, th: string, en: string): Named => ({ code, th, en });
const U = (code: string, th: string, en: string, rate?: number) => ({ ...n(code, th, en), ...(rate ? { rate } : {}) });

const UNITS_GOODS = [U('PCS', 'ชิ้น', 'Piece'), U('BOX', 'กล่อง', 'Box'), U('PACK', 'แพ็ค', 'Pack'), U('SET', 'ชุด', 'Set'), U('DZ', 'โหล', 'Dozen', 12), U('CTN', 'ลัง', 'Carton'),
  U('BTL', 'ขวด', 'Bottle'), U('BAG', 'ถุง', 'Bag'), U('KG', 'กิโลกรัม', 'Kilogram'), U('L', 'ลิตร', 'Litre'), U('M', 'เมตร', 'Metre'), U('ROLL', 'ม้วน', 'Roll')];
const UNITS_SERVICE = [U('JOB', 'งาน', 'Job'), U('TIME', 'ครั้ง', 'Time')];
const BANKS = [n('BBL', 'ธนาคารกรุงเทพ', 'Bangkok Bank'), n('KBANK', 'ธนาคารกสิกรไทย', 'Kasikornbank'), n('KTB', 'ธนาคารกรุงไทย', 'Krungthai Bank'),
  n('SCB', 'ธนาคารไทยพาณิชย์', 'Siam Commercial Bank'), n('BAY', 'ธนาคารกรุงศรีอยุธยา', 'Bank of Ayudhya (Krungsri)'), n('TTB', 'ธนาคารทหารไทยธนชาต', 'TMBThanachart Bank'),
  n('GSB', 'ธนาคารออมสิน', 'Government Savings Bank'), n('BAAC', 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', 'BAAC'), n('UOB', 'ธนาคารยูโอบี', 'UOB'),
  n('CIMB', 'ธนาคารซีไอเอ็มบี ไทย', 'CIMB Thai'), n('LHB', 'ธนาคารแลนด์ แอนด์ เฮ้าส์', 'Land and Houses Bank'), n('KKP', 'ธนาคารเกียรตินาคินภัทร', 'Kiatnakin Phatra Bank')];
/** ตารางข้อมูลที่ใช้ร่วมทุกประเภทธุรกิจ (สถานะเช็คตามรหัสของ Express) */
const LOOKUPS_COMMON: StarterData['lookups'] = [
  { type: '02', rows: [n('00', 'เช็คในมือ', 'Cheque on hand'), n('01', 'นำฝาก/รอเรียกเก็บ', 'Deposited'), n('02', 'เช็คคืนยื่นใหม่', 'Re-presented'), n('05', 'จ่ายแล้วรอผ่าน', 'Paid, awaiting clearing'), n('10', 'ผ่านแล้ว', 'Cleared'), n('20', 'เช็คคืน', 'Returned')] },
  { type: '23', rows: [n('1', 'ชุดระดับ 1 (ประกอบจากสินค้าทั่วไป)', 'Kit level 1 (from regular items)')] },
  { type: '41', rows: [n('OWN', 'รถบริษัท', 'Company vehicle'), n('PCK', 'ลูกค้ารับเอง', 'Customer pick-up'), n('THP', 'ไปรษณีย์ไทย', 'Thailand Post'), n('KRY', 'เคอรี่ เอ็กซ์เพรส', 'Kerry Express'), n('FLS', 'แฟลช เอ็กซ์เพรส', 'Flash Express')] },
  { type: '42', rows: [n('01', 'ลูกค้ายกเลิกคำสั่งซื้อ', 'Customer cancelled'), n('02', 'สินค้าหมด/เลิกผลิต', 'Out of stock / discontinued'), n('03', 'ลูกค้าเปลี่ยนรายการ', 'Customer changed the order')] },
  { type: '43', rows: [n('01', 'ผู้จำหน่ายส่งของไม่ครบ', 'Supplier short-shipped'), n('02', 'ยกเลิกเพราะราคาเปลี่ยน', 'Price changed'), n('03', 'สั่งเกินความต้องการ', 'Over-ordered')] },
  { type: '44', rows: [n('1', 'รอลูกค้าพิจารณา', 'Awaiting customer'), n('2', 'ลูกค้าอนุมัติ (ได้งาน)', 'Accepted'), n('3', 'ไม่ได้งาน', 'Lost')] },
  { type: '45', rows: [n('CORP', 'บริษัทเอกชน', 'Private company'), n('SHOP', 'ร้านค้า/บุคคล', 'Shop / individual'), n('GOV', 'หน่วยงานราชการ/รัฐวิสาหกิจ', 'Government / state enterprise'), n('EDU', 'สถานศึกษา', 'Education'), n('FOR', 'ลูกค้าต่างประเทศ', 'Overseas customer')] },
  { type: '46', rows: [n('MFG', 'ผู้ผลิต', 'Manufacturer'), n('DIS', 'ตัวแทนจำหน่าย', 'Distributor'), n('SRV', 'ผู้ให้บริการ', 'Service provider'), n('UTL', 'สาธารณูปโภค', 'Utilities'), n('IND', 'บุคคลธรรมดา', 'Individual')] },
  { type: '47', rows: [n('IN', 'พนักงานขายในสำนักงาน', 'Inside sales'), n('OUT', 'พนักงานขายภาคสนาม', 'Field sales')] },
  { type: '51', rows: [n('01', 'สินค้าซื้อแล้วไม่รับเปลี่ยนหรือคืน ยกเว้นสินค้ามีตำหนิจากการผลิต', 'Goods sold are not returnable unless defective'), n('02', 'กรุณาสั่งจ่ายเช็คขีดคร่อมในนามบริษัทเท่านั้น', 'Please make crossed cheques payable to the company only'), n('03', 'ราคานี้ยืนราคา 30 วัน', 'This quotation is valid for 30 days')] },
  { type: '52', rows: [n('BLD', 'อาคาร', 'Building'), n('VEH', 'ยานพาหนะ', 'Vehicle'), n('FUR', 'เฟอร์นิเจอร์และเครื่องตกแต่ง', 'Furniture and fixtures'), n('OFE', 'อุปกรณ์สำนักงาน', 'Office equipment'), n('COM', 'คอมพิวเตอร์', 'Computer')] },
  { type: '53', rows: [n('W', 'รอเบิกชดเชย', 'Awaiting reimbursement'), n('R', 'เบิกชดเชยแล้ว', 'Reimbursed')] },
  { type: '55', rows: [n('S03', 'ภ.ง.ด.3 (บุคคลธรรมดา)', 'PND 3 (individual)'), n('S53', 'ภ.ง.ด.53 (นิติบุคคล)', 'PND 53 (juristic person)')] },
];
const ASSET_GROUPS: StarterData['assetGroups'] = [
  { ...n('BLD', 'อาคาร', 'Building'), asset: '1410-02', expense: '5340-02', accum: '1420-02' },
  { ...n('VEH', 'ยานพาหนะ', 'Vehicle'), asset: '1410-05', expense: '5340-05', accum: '1420-05' },
  { ...n('FUR', 'เครื่องตกแต่งสำนักงาน', 'Furniture and fixtures'), asset: '1410-04', expense: '5340-04', accum: '1420-04' },
  { ...n('OFE', 'เครื่องใช้สำนักงาน', 'Office equipment'), asset: '1410-06', expense: '5340-06', accum: '1420-06' },
  { ...n('COM', 'คอมพิวเตอร์และอุปกรณ์', 'Computers and equipment'), asset: '1410-06', expense: '5340-06', accum: '1420-06' },
];
/** วิธีรับ/จ่ายชำระ (คู่มือบทที่ 5 S-SET-06/08 รูป 7: CH รับเงินสด 1111-00 · QR เช็ครับ · VS บัตร) */
const PAYMENTS: StarterData['paymentMethods'] = [
  { direction: 'R', seq: '01', ...n('CH', 'รับเงินสด', 'Cash received'), kind: 'CASH', account: '1111-00' },
  { direction: 'R', seq: '02', ...n('QR', 'เช็ครับ', 'Cheque received'), kind: 'CHEQUE', account: '1130-02', cheque: true },
  { direction: 'R', seq: '03', ...n('VS', 'บัตรเครดิต', 'Credit card'), kind: 'CARD', account: '1130-02', cheque: true },
  { direction: 'P', seq: '01', ...n('CH', 'จ่ายเงินสด', 'Cash paid'), kind: 'CASH', account: '1111-00' },
];
const DEPT = (rows: Array<[string, string, string]>) => rows.map(([c, th, en]) => n(c, th, en));

const TEMPLATES: Record<Exclude<StarterKey, 'BLANK'>, StarterData> = {
  TRADE: {
    units: [...UNITS_GOODS, ...UNITS_SERVICE],
    warehouses: [n('01', 'คลังสินค้าสำนักงานใหญ่', 'Head office warehouse')],
    banks: BANKS,
    departments: DEPT([['01', 'ฝ่ายบริหาร', 'Management'], ['02', 'ฝ่ายขาย', 'Sales'], ['03', 'ฝ่ายบัญชีและการเงิน', 'Accounting and finance'], ['04', 'ฝ่ายคลังสินค้า', 'Warehouse']]),
    lookups: [...LOOKUPS_COMMON, { type: '22', rows: [n('GEN', 'สินค้าทั่วไป', 'General goods'), n('SET', 'สินค้าชุด', 'Kits'), n('SRV', 'บริการ', 'Services')] }],
    itemGroups: [{ ...n('GD', 'สินค้าซื้อมาขายไป (ถัวเฉลี่ย)', 'Trading goods (average cost)'), cost: 'A', inventory: '1140-02', cogs: '5110-00', sales: '4100-11', sales_return: '4100-30', purchase: '5130-01', purchase_return: '5130-03' }],
    assetGroups: ASSET_GROUPS,
    paymentMethods: PAYMENTS,
    settings: { 'ic.main_warehouse': '01' },
  },
  SERVICE: {
    units: [...UNITS_SERVICE, U('HR', 'ชั่วโมง', 'Hour'), U('DAY', 'วัน', 'Day'), U('MON', 'เดือน', 'Month'), U('TRIP', 'เที่ยว', 'Trip'), U('PCS', 'ชิ้น', 'Piece'), U('SET', 'ชุด', 'Set')],
    warehouses: [n('01', 'คลังวัสดุ (สนญ.)', 'Materials store (head office)')],
    banks: BANKS,
    departments: DEPT([['01', 'ฝ่ายบริหาร', 'Management'], ['02', 'ฝ่ายบริการ/ปฏิบัติการ', 'Service / operations'], ['03', 'ฝ่ายบัญชีและการเงิน', 'Accounting and finance'], ['04', 'ฝ่ายการตลาด', 'Marketing']]),
    lookups: [...LOOKUPS_COMMON, { type: '22', rows: [n('SRV', 'บริการ', 'Services'), n('MAT', 'วัสดุสิ้นเปลือง', 'Consumables')] }],
    itemGroups: [
      { ...n('SV', 'งานบริการ', 'Services'), item_specific: false, sales: '4300-05' },
      { ...n('MT', 'วัสดุสิ้นเปลือง', 'Consumables'), cost: 'A', inventory: '1140-02', cogs: '5110-00', sales: '4100-11', sales_return: '4100-30', purchase: '5130-01', purchase_return: '5130-03' },
    ],
    assetGroups: ASSET_GROUPS,
    paymentMethods: PAYMENTS,
    // ภาษีขายบริการ เกณฑ์เงินสด (ม.78/1(2) จุดความรับผิดของบริการ = ได้รับชำระ · HANDOFF 160 D1)
    settings: { 'ic.main_warehouse': '01', 'ar.service_vat_basis': '2' },
  },
  MFG: {
    units: [...UNITS_GOODS, ...UNITS_SERVICE, U('G', 'กรัม', 'Gram'), U('ML', 'มิลลิลิตร', 'Millilitre'), U('SHEET', 'แผ่น', 'Sheet'), U('LOT', 'ล็อต', 'Lot')],
    warehouses: [n('01', 'คลังวัตถุดิบ', 'Raw materials'), n('02', 'คลังงานระหว่างผลิต', 'Work in process'), n('03', 'คลังสินค้าสำเร็จรูป', 'Finished goods')],
    banks: BANKS,
    departments: DEPT([['01', 'ฝ่ายบริหาร', 'Management'], ['02', 'ฝ่ายผลิต', 'Production'], ['03', 'ฝ่ายจัดซื้อ', 'Purchasing'], ['04', 'ฝ่ายคลังสินค้า', 'Warehouse'], ['05', 'ฝ่ายขาย', 'Sales'], ['06', 'ฝ่ายบัญชีและการเงิน', 'Accounting and finance']]),
    lookups: [...LOOKUPS_COMMON, { type: '22', rows: [n('RM', 'วัตถุดิบ', 'Raw materials'), n('PK', 'วัสดุบรรจุภัณฑ์', 'Packaging'), n('FG', 'สินค้าสำเร็จรูป', 'Finished goods'), n('SRV', 'บริการ', 'Services')] },
      { type: '61', rows: [n('RM', 'วัตถุดิบ', 'Raw materials'), n('DL', 'ค่าแรงทางตรง', 'Direct labour'), n('OH', 'โสหุ้ยการผลิต', 'Manufacturing overhead')] }],
    itemGroups: [
      { ...n('RM', 'วัตถุดิบ', 'Raw materials'), cost: 'A', inventory: '1140-01', cogs: '5110-00', sales: '4300-04', sales_return: '4100-30', purchase: '5130-01', purchase_return: '5130-03' },
      { ...n('WIP', 'งานระหว่างทำ', 'Work in process'), cost: 'A', inventory: '1140-03', cogs: '5110-00', sales: '4100-13', sales_return: '4100-30' },
      { ...n('FG', 'สินค้าสำเร็จรูป', 'Finished goods'), cost: 'A', inventory: '1140-02', cogs: '5110-00', sales: '4100-13', sales_return: '4100-30' },
      { ...n('PK', 'วัสดุบรรจุภัณฑ์', 'Packaging'), cost: 'A', inventory: '1140-01', cogs: '5110-00', sales: '4300-04', sales_return: '4100-30', purchase: '5130-01', purchase_return: '5130-03' },
    ],
    assetGroups: [...ASSET_GROUPS, { ...n('MCH', 'เครื่องจักรและอุปกรณ์โรงงาน', 'Machinery and factory equipment'), asset: '1410-07', expense: '5340-07', accum: '1420-08' }],
    paymentMethods: PAYMENTS,
    // คลังหลัก = สินค้าสำเร็จรูป (ใช้ตอนขาย · HANDOFF 160 D2)
    settings: { 'ic.main_warehouse': '03' },
  },
};

/** ข้อมูลตั้งต้นของประเภทธุรกิจ (ว่าง = ไม่มี) */
export function starterData(key: StarterKey): StarterData | null {
  return key === 'BLANK' ? null : TEMPLATES[key];
}
/** รายการตารางที่ใส่ (ชื่อบนหน้าจอ) — ใช้ในหน้าดูก่อนเติมข้อมูล */
export const STARTER_TABLES = [
  ['units', 'หน่วยนับ'], ['warehouses', 'คลังสินค้า'], ['banks', 'ชื่อธนาคาร'], ['departments', 'แผนก'], ['lookups', 'ตารางข้อมูลอื่น'],
  ['itemGroups', 'กลุ่มบัญชีสินค้า'], ['assetGroups', 'กลุ่มบัญชีทรัพย์สิน'], ['paymentMethods', 'วิธีรับ/จ่ายชำระหนี้'], ['settings', 'ค่าเริ่มต้นแต่ละระบบ'],
] as const;
