/**
 * แค็ตตาล็อกรายงาน (คู่มือบทที่ 17) — ต้นไม้รายงานตามรหัสเมนูของ Express (เช่น 1.4.1 = 141) + ขอบเขตของแต่ละรายงาน
 * ฝั่ง server ลงทะเบียนตัวคำนวณตามรหัส · หน้าจอสร้างฟอร์มขอบเขตจาก filters
 */
export type ReportEntity = 'customer' | 'supplier' | 'salesperson' | 'item' | 'account' | 'warehouse' | 'area' | 'customerType' | 'supplierType' | 'bankAccount' | 'book';
export type ReportFilter =
  | { key: string; kind: 'dateRange' | 'asOf' | 'period' | 'dept' | 'docNo'; label?: string }
  | { key: string; kind: 'range'; entity: ReportEntity; label: string }
  | { key: string; kind: 'check'; label: string; default?: boolean }
  | { key: string; kind: 'select'; label: string; options: Array<[string, string]>; default?: string };
export interface ReportDef { code: string; title: string; menu: string; filters: ReportFilter[]; landscape?: boolean; note?: string }
export interface ReportNode { code: string; title: string; children?: ReportNode[]; def?: ReportDef }

/** ผลลัพธ์รายงาน (ทุกตัวใช้รูปแบบเดียว — แสดง พิมพ์ ส่งออก) */
export interface ReportColumn { key: string; label: string; kind?: 'text' | 'mono' | 'money' | 'qty' | 'date' | 'int'; width?: number }
export interface ReportRow { t?: 'row' | 'group' | 'sub' | 'detail' | 'total' | 'note'; c: Record<string, string | number | null>; link?: string | null; muted?: boolean }
export interface ReportResult { code: string; title: string; subtitle?: string; columns: ReportColumn[]; rows: ReportRow[]; truncated?: boolean; landscape?: boolean }

/** การยื่น: ปกติ / ยื่นเพิ่มเติม (ล่าช้า) */
const FILING: ReportFilter = { key: 'filing', kind: 'select', label: 'การยื่น', options: [['normal', 'ยื่นปกติ'], ['late', 'ยื่นเพิ่มเติม'], ['all', 'ทั้งหมด']], default: 'normal' };
const F = {
  docNo: { key: 'doc_no', kind: 'docNo' } as ReportFilter,
  date: { key: 'date', kind: 'dateRange' } as ReportFilter,
  asOf: { key: 'as_of', kind: 'asOf' } as ReportFilter,
  period: { key: 'period', kind: 'period' } as ReportFilter,
  dept: { key: 'dept', kind: 'dept' } as ReportFilter,
  cus: { key: 'customer', kind: 'range', entity: 'customer', label: 'รหัสลูกค้า' } as ReportFilter,
  sup: { key: 'supplier', kind: 'range', entity: 'supplier', label: 'รหัสผู้จำหน่าย' } as ReportFilter,
  slm: { key: 'salesperson', kind: 'range', entity: 'salesperson', label: 'รหัสพนักงานขาย' } as ReportFilter,
  area: { key: 'area', kind: 'range', entity: 'area', label: 'เขตการขาย' } as ReportFilter,
  ctype: { key: 'ctype', kind: 'range', entity: 'customerType', label: 'ประเภทลูกค้า' } as ReportFilter,
  stype: { key: 'stype', kind: 'range', entity: 'supplierType', label: 'ประเภทผู้จำหน่าย' } as ReportFilter,
  item: { key: 'item', kind: 'range', entity: 'item', label: 'รหัสสินค้า' } as ReportFilter,
  wh: { key: 'warehouse', kind: 'range', entity: 'warehouse', label: 'คลังสินค้า' } as ReportFilter,
  acc: { key: 'account', kind: 'range', entity: 'account', label: 'เลขที่บัญชี' } as ReportFilter,
  bank: { key: 'bank', kind: 'range', entity: 'bankAccount', label: 'บัญชีเงินฝาก' } as ReportFilter,
  book: { key: 'book', kind: 'range', entity: 'book', label: 'สมุดรายวัน' } as ReportFilter,
  detail: { key: 'detail', kind: 'check', label: 'พิมพ์รายละเอียด', default: true } as ReportFilter,
  cancelled: { key: 'cancelled', kind: 'check', label: 'รวมเอกสารที่ยกเลิก', default: false } as ReportFilter,
  zero: { key: 'zero', kind: 'check', label: 'พิมพ์รายการที่ยอดเป็น 0', default: false } as ReportFilter,
};

/** ทะเบียนเอกสาร: เรียง/แยกตามต่าง ๆ — mode อยู่ท้ายรหัส */
export type RegisterMode = 'no' | 'date' | 'party' | 'salesperson' | 'area_slm' | 'area_party' | 'due_party' | 'due_slm' | 'due_no';
export interface RegisterSpec { classes: string[]; side: 'AR' | 'AP'; title: string; due?: boolean }
/** กลุ่มเอกสารของรายงานกลุ่ม 1/2 (รหัสกลุ่ม → หมวดเอกสาร) */
export const REGISTER_GROUPS: Record<string, RegisterSpec> = {
  '1.1': { classes: ['AI'], side: 'AR', title: 'รับเงินมัดจำ' },
  '1.2': { classes: ['HS'], side: 'AR', title: 'ขายเงินสด (บิลเงินสด)' },
  '1.3': { classes: ['SO'], side: 'AR', title: 'ใบสั่งขาย' },
  '1.4': { classes: ['IV'], side: 'AR', title: 'ขายเงินเชื่อ (ใบกำกับสินค้า)', due: true },
  '1.5': { classes: ['OI'], side: 'AR', title: 'รายได้อื่น ๆ' },
  '1.6': { classes: ['BS'], side: 'AR', title: 'ใบวางบิล' },
  '1.7': { classes: ['DR'], side: 'AR', title: 'ใบเพิ่มหนี้' },
  '1.8': { classes: ['CN'], side: 'AR', title: 'ใบลดหนี้/รับคืนสินค้า' },
  '1.9': { classes: ['RE'], side: 'AR', title: 'การรับชำระหนี้' },
  '1.G': { classes: ['QT'], side: 'AR', title: 'ใบเสนอราคา' },
  '2.1': { classes: ['AE'], side: 'AP', title: 'จ่ายเงินมัดจำ' },
  '2.2': { classes: ['HP'], side: 'AP', title: 'ซื้อเงินสด' },
  '2.3': { classes: ['PO'], side: 'AP', title: 'ใบสั่งซื้อ' },
  '2.4': { classes: ['RR'], side: 'AP', title: 'ซื้อเงินเชื่อ (ใบรับสินค้า)', due: true },
  '2.5': { classes: ['OE'], side: 'AP', title: 'ค่าใช้จ่ายอื่น ๆ' },
  '2.6': { classes: ['BR'], side: 'AP', title: 'ใบรับวางบิล' },
  '2.7': { classes: ['CP'], side: 'AP', title: 'ใบเพิ่มหนี้' },
  '2.8': { classes: ['DN'], side: 'AP', title: 'ใบลดหนี้/ส่งคืนสินค้า' },
  '2.9': { classes: ['PS'], side: 'AP', title: 'จ่ายชำระหนี้' },
};
const MODE_TITLE: Record<RegisterMode, (s: RegisterSpec) => string> = {
  no: () => 'เรียงตามเลขที่', date: () => 'เรียงตามวันที่', party: (s) => (s.side === 'AR' ? 'แยกตามลูกค้า' : 'แยกตามผู้จำหน่าย'), salesperson: () => 'แยกตามพนักงานขาย',
  area_slm: () => 'แยกตามเขตการขาย พนักงานขาย', area_party: () => 'แยกตามเขตการขาย ลูกค้า',
  due_party: (s) => (s.side === 'AR' ? 'ถึงกำหนดเก็บเงิน แยกตามลูกค้า' : 'ถึงกำหนดจ่ายเงิน แยกตามผู้จำหน่าย'), due_slm: () => 'ถึงกำหนดเก็บเงิน แยกตามพนักงานขาย',
  due_no: (s) => (s.side === 'AR' ? 'ถึงกำหนดเก็บเงิน เรียงตามเลขที่เอกสาร' : 'ถึงกำหนดจ่ายเงิน เรียงตามวันที่ซื้อ'),
};
/** โหมดย่อยของแต่ละกลุ่ม (ลำดับ = รหัสย่อย 1, 2, 3 …) — 1.4 ตามภาพคู่มือหน้า 309 · 2.4 ตามหน้า 339 */
export function registerModes(group: string): RegisterMode[] {
  const s = REGISTER_GROUPS[group]!;
  if (group === '1.4') return ['no', 'date', 'party', 'salesperson', 'area_slm', 'area_party', 'due_party', 'due_slm', 'due_no'];
  if (group === '2.4') return ['no', 'date', 'party', 'due_party', 'due_no'];
  return s.side === 'AR' ? ['no', 'date', 'party', 'salesperson'] : ['no', 'date', 'party'];
}
const SUB = '123456789ABCDEFGH';
function registerNode(group: string): ReportNode {
  const s = REGISTER_GROUPS[group]!;
  return { code: group, title: s.title, children: registerModes(group).map((m, i) => {
    const code = `${group}.${SUB[i]}`;
    const due = m.startsWith('due');
    const filters: ReportFilter[] = [F.docNo, due ? { key: 'date', kind: 'dateRange', label: 'วันที่ครบกำหนด' } : F.date, s.side === 'AR' ? F.cus : F.sup, ...(s.side === 'AR' ? [F.slm] : []), ...(m.startsWith('area') ? [F.area] : []), F.dept, F.detail, F.cancelled];
    return { code, title: MODE_TITLE[m](s), def: { code, title: `${s.title} / ${MODE_TITLE[m](s)}`, menu: s.side === 'AR' ? 'RP.SA' : 'RP.PU', filters, landscape: true } };
  }) };
}
/** รหัสรายงานทะเบียนเอกสาร → กลุ่ม + โหมด */
export function registerOf(code: string): { group: string; spec: RegisterSpec; mode: RegisterMode } | null {
  const m = /^([12]\.[1-9G])\.([1-9A-H])$/.exec(code);
  if (!m || !REGISTER_GROUPS[m[1]!]) return null;
  const mode = registerModes(m[1]!)[SUB.indexOf(m[2]!)];
  return mode ? { group: m[1]!, spec: REGISTER_GROUPS[m[1]!]!, mode } : null;
}

const leaf = (code: string, title: string, menu: string, filters: ReportFilter[], extra: Partial<ReportDef> = {}): ReportNode => ({ code, title, def: { code, title, menu, filters, ...extra } });
export const REPORT_TREE: ReportNode[] = [
  { code: '1', title: 'รายงานลูกหนี้', children: [
    ...['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9'].map(registerNode),
    { code: '1.A', title: 'ลูกหนี้คงค้าง ณ วันที่', children: [
      leaf('1.A.1', 'แบบสรุป', 'RP.SA', [F.asOf, F.cus, F.slm, F.area, F.dept, F.zero]), leaf('1.A.2', 'แบบละเอียด', 'RP.SA', [F.asOf, F.cus, F.slm, F.area, F.dept], { landscape: true })] },
    leaf('1.B', 'สถานะลูกหนี้', 'RP.SA', [F.period, F.cus, F.ctype, F.area, F.slm, F.zero], { landscape: true }),
    { code: '1.C', title: 'วิเคราะห์อายุหนี้ (บิลค้างรับ)', children: [
      leaf('1.C.1', 'แบบสรุป', 'RP.SA', [F.asOf, F.cus, F.slm, F.area], { landscape: true }), leaf('1.C.2', 'แบบละเอียด', 'RP.SA', [F.asOf, F.cus, F.slm, F.area], { landscape: true })] },
    leaf('1.D', 'รายการเคลื่อนไหวลูกหนี้', 'RP.SA', [F.date, F.cus, F.slm], { landscape: true }),
    leaf('1.E', 'ลูกหนี้เกินวงเงิน', 'RP.SA', [F.asOf, F.cus, F.slm]),
    leaf('1.F', 'รายละเอียดลูกค้า', 'RP.SA', [F.cus, F.ctype, F.area, F.slm], { landscape: true }),
    registerNode('1.G'),
    leaf('1.H', 'ตรวจสอบข้อมูลระบบขาย', 'RP.SA', [F.date]),
    leaf('1.4.A', 'ใบยืนยันยอดลูกหนี้', 'RP.SA', [F.asOf, F.cus, F.slm]),
  ] },
  { code: '2', title: 'รายงานเจ้าหนี้', children: [
    ...['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9'].map(registerNode),
    { code: '2.A', title: 'เจ้าหนี้คงค้าง ณ วันที่', children: [
      leaf('2.A.1', 'แบบสรุป', 'RP.PU', [F.asOf, F.sup, F.dept, F.zero]), leaf('2.A.2', 'แบบละเอียด', 'RP.PU', [F.asOf, F.sup, F.dept], { landscape: true })] },
    leaf('2.B', 'สถานะเจ้าหนี้', 'RP.PU', [F.period, F.sup, F.stype, F.zero], { landscape: true }),
    { code: '2.C', title: 'วิเคราะห์อายุหนี้ (บิลค้างจ่าย)', children: [
      leaf('2.C.1', 'แบบสรุป', 'RP.PU', [F.asOf, F.sup], { landscape: true }), leaf('2.C.2', 'แบบละเอียด', 'RP.PU', [F.asOf, F.sup], { landscape: true })] },
    leaf('2.D', 'รายการเคลื่อนไหวเจ้าหนี้', 'RP.PU', [F.date, F.sup], { landscape: true }),
    leaf('2.E', 'ซื้อเกินวงเงิน', 'RP.PU', [F.asOf, F.sup]),
    leaf('2.F', 'รายละเอียดผู้จำหน่าย/เจ้าหนี้', 'RP.PU', [F.sup, F.stype], { landscape: true }),
    leaf('2.G', 'ตรวจสอบข้อมูลระบบซื้อ', 'RP.PU', [F.date]),
    leaf('2.4.6', 'ใบยืนยันยอดเจ้าหนี้', 'RP.PU', [F.asOf, F.sup]),
  ] },
  { code: '3', title: 'รายงานเกี่ยวกับเช็ค', children: [
    leaf('3.1', 'เช็ครับในมือ', 'RP.CHQ', [F.asOf, F.cus]), leaf('3.2', 'เช็ครับรอเรียกเก็บ', 'RP.CHQ', [F.asOf, F.bank, F.cus]),
    leaf('3.3', 'เช็ครับผ่านแล้ว', 'RP.CHQ', [F.date, F.bank, F.cus]), leaf('3.4', 'เช็ครับคืน', 'RP.CHQ', [F.date, F.cus]),
    leaf('3.5', 'เช็ครับเรียงตามวันที่รับเช็ค', 'RP.CHQ', [F.date, F.cus], { landscape: true }),
    leaf('3.6', 'เช็คจ่ายยังไม่ผ่าน', 'RP.CHQ', [F.asOf, F.bank, F.sup]), leaf('3.7', 'เช็คจ่ายผ่านแล้ว', 'RP.CHQ', [F.date, F.bank, F.sup]),
    leaf('3.A', 'เช็คจ่ายเรียงตามวันที่ออกเช็ค', 'RP.CHQ', [F.date, F.bank, F.sup], { landscape: true }),
    leaf('3.B', 'ใบนำฝากเช็ค', 'RP.CHQ', [F.date, F.bank, F.detail]),
  ] },
  { code: '4', title: 'รายงานสินค้าคงคลัง', children: [
    { code: '4.1', title: 'แจกแจงรับ-จ่ายสินค้า', children: [
      leaf('4.1.1', 'แจกแจงรับ-จ่าย (รวมทุกคลัง)', 'RP.IC', [F.date, F.item], { landscape: true }), leaf('4.1.5', 'แจกแจงรับ-จ่าย แยกตามคลัง', 'RP.IC', [F.date, F.item, F.wh], { landscape: true })] },
    { code: '4.2', title: 'สินค้าคงเหลือ', children: [
      leaf('4.2.1', 'สินค้าคงเหลือ (รวมทุกคลัง)', 'RP.IC', [F.asOf, F.item, F.zero]), leaf('4.2.7', 'สินค้าคงเหลือ แยกตามคลัง', 'RP.IC', [F.asOf, F.item, F.wh, F.zero])] },
    leaf('4.3', 'สินค้าต่ำกว่าจุดสั่งซื้อ', 'RP.IC', [F.asOf, F.item, F.wh]),
    leaf('4.4', 'ใบเบิก/โอน/ปรับปรุงสินค้า', 'RP.IC', [F.date, F.detail, F.cancelled], { landscape: true }),
    leaf('4.5', 'รายละเอียดสินค้า', 'RP.IC', [F.item], { landscape: true }),
    leaf('4.6', 'ตรวจยอดสินค้า (ติดลบ/มูลค่าค้าง/เทียบยอดที่ย้ายมา)', 'RP.IC', [F.asOf, F.item, { key: 'snapshot', kind: 'check', label: 'เทียบยอดคงเหลือที่ย้ายมาจาก Express', default: true }], { landscape: true }),
  ] },
  { code: '5', title: 'รายงานบัญชี', children: [
    leaf('5.1', 'ผังบัญชี', 'RP.GL', [F.acc]),
    leaf('5.3', 'สรุปยอดเคลื่อนไหว', 'RP.GL', [F.date, F.acc, F.dept, F.zero], { landscape: true }),
    leaf('5.7', 'รายการงบประมาณ', 'RP.GL', [F.period, F.acc, F.dept], { landscape: true }),
    leaf('5.8', 'กระดาษทำการ', 'RP.GL', [F.date, F.dept], { landscape: true }),
    { code: '5.A', title: 'ตรวจสอบข้อมูล', children: [
      leaf('5.A.1', 'รายการที่เลขบัญชีไม่ถูกต้อง', 'RP.GL', []), leaf('5.A.2', 'ใบสำคัญที่ยอดไม่ได้ดุลย์', 'RP.GL', [F.date]),
      leaf('5.A.3', 'รายงานการแก้ไขปรับปรุงรายการ', 'RP.GL', [F.date])] },
    leaf('5.B', 'รายการทรัพย์สิน', 'RP.GL', [{ key: 'date', kind: 'dateRange', label: 'ค่าเสื่อมงวดวันที่' }, { key: 'status', kind: 'select', label: 'สถานะ', options: [['all', 'ทั้งหมด'], ['A', 'ใช้งานอยู่'], ['S', 'ขาย/ตัดจำหน่ายแล้ว']], default: 'all' }], { landscape: true }),
    leaf('5.C', 'เงินสดย่อย', 'RP.GL', [F.date, F.detail]),
  ] },
  { code: '6', title: 'รายงานภาษี', children: [
    leaf('6.1', 'รายงานภาษีมูลค่าเพิ่ม (สรุปภาษีซื้อและภาษีขาย)', 'RP.TAX', [F.period, FILING]),
    leaf('6.2', 'รายงานภาษีซื้อ', 'RP.TAX', [F.period, FILING, { key: 'variant', kind: 'select', label: 'รูปแบบรายงาน', options: [['std', 'ต้นฉบับมาตรฐาน'], ['claim', 'แยกขอคืนได้ / ขอคืนไม่ได้'], ['bill', 'แยกตามประเภทบิล (ซื้อสด/เชื่อ/ลดหนี้/มัดจำ)'], ['nil', 'พิมพ์รายงานว่าไม่มีรายการ']], default: 'std' }, F.dept], { landscape: true }),
    leaf('6.3', 'รายงานภาษีขาย', 'RP.TAX', [F.period, FILING, { key: 'variant', kind: 'select', label: 'รูปแบบรายงาน', options: [['std', 'ต้นฉบับมาตรฐาน'], ['zero', 'อัตราศูนย์'], ['bill', 'แยกตามประเภทบิล (ขายสด/เชื่อ/ลดหนี้/มัดจำ)'], ['nil', 'พิมพ์รายงานว่าไม่มีรายการ']], default: 'std' }, F.dept], { landscape: true }),
    leaf('6.4', 'แบบ ภ.พ.30 (แบบแสดงรายการภาษีมูลค่าเพิ่ม)', 'RP.TAX', [F.period, FILING, { key: 'carry', kind: 'select', label: 'ภาษีชำระเกินยกมา', options: [['auto', 'คำนวณจากงวดก่อน'], ['0', 'ไม่มี']], default: 'auto' }]),
    leaf('6.5', 'ใบแนบ ภ.ง.ด.3 (บุคคลธรรมดา)', 'RP.TAX', [F.period, FILING], { landscape: true }),
    leaf('6.6', 'ใบแนบ ภ.ง.ด.53 (นิติบุคคล)', 'RP.TAX', [F.period, FILING], { landscape: true }),
    leaf('6.7', 'แบบ ภ.พ.36 (ภาษีมูลค่าเพิ่มนำส่งแทนผู้ให้บริการต่างประเทศ)', 'RP.TAX', [F.period], { landscape: true }),
  ] },
  { code: '7', title: 'รายงานวิเคราะห์การขาย', children: [
    { code: '7.1', title: 'ประวัติการขาย', children: [
      leaf('7.1.1', 'แยกตามลูกค้า', 'RP.SA', [F.date, F.cus, F.item, F.slm], { landscape: true }), leaf('7.1.2', 'แยกตามสินค้า', 'RP.SA', [F.date, F.item, F.cus], { landscape: true }),
      leaf('7.1.3', 'แยกตามพนักงานขาย', 'RP.SA', [F.date, F.slm, F.cus, F.item], { landscape: true })] },
    leaf('7.6', 'สรุปยอดขาย', 'RP.SA', [F.date, F.cus, F.item, F.slm, { key: 'by', kind: 'select', label: 'สรุปตาม', options: [['item', 'สินค้า'], ['customer', 'ลูกค้า'], ['salesperson', 'พนักงานขาย'], ['month', 'เดือน']], default: 'item' }], { landscape: true }),
  ] },
  { code: '8', title: 'รายงานวิเคราะห์การซื้อ', children: [
    leaf('8.1', 'ประวัติการซื้อ', 'RP.PU', [F.date, F.sup, F.item], { landscape: true }),
    leaf('8.2', 'สรุปยอดซื้อ', 'RP.PU', [F.date, F.sup, F.item, { key: 'by', kind: 'select', label: 'สรุปตาม', options: [['item', 'สินค้า'], ['supplier', 'ผู้จำหน่าย'], ['month', 'เดือน']], default: 'item' }], { landscape: true }),
  ] },
];

export function findReport(code: string, nodes: ReportNode[] = REPORT_TREE): ReportDef | null {
  for (const n of nodes) {
    if (n.def && n.code === code) return n.def;
    if (n.children) { const f = findReport(code, n.children); if (f) return f; }
  }
  return null;
}
