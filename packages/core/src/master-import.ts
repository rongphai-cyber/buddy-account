/**
 * นำเข้าข้อมูลหลักจาก Excel (HANDOFF 173 — เจ้าของ 22/11/2569 "เพิ่มใหม่+แก้เมื่อติ๊ก")
 * ลูกค้า · ผู้จำหน่าย · สินค้า · สินค้าบริการ · ทะเบียนทรัพย์สิน — หนึ่งแถว = หนึ่งรหัส
 * รหัสที่ยังไม่มี = เพิ่มใหม่ (ว่าง = ออกรหัสให้ตามรูปแบบรหัส) · รหัสที่มีแล้ว = ข้าม เว้นแต่ติ๊ก "แก้ข้อมูลรหัสเดิมด้วย"
 * แก้: ช่องว่าง = คงค่าเดิม (ไม่ลบค่าเดิม) · ไม่เปลี่ยนรหัส · ตรวจและบันทึกด้วยฟังก์ชันเดียวกับหน้าจอ (server)
 * ส่วนนี้: คอลัมน์ของแต่ละแฟ้ม + อ่านตารางเป็นค่าต่อแถว (วันที่ → ISO · ตัวเลข · ใช่/ไม่ใช่ · ตัวเลือก) — การหารหัสอ้างอิงอยู่ที่ server
 */
import type { YearSystem } from './date.js';
import { findHeader, importDate, importNumber, MAX_IMPORT_ROWS, type ImportIssue, type ImportNeed } from './trade-import.js';

/** ref = ช่องที่อ้างรหัสข้อมูลอื่น (server หา id จากรหัส/ชื่อ) */
export type MasterRef = 'account' | 'salesperson' | 'unit' | 'item_group' | 'asset_group' | 'department' | 'supplier';
export interface MasterCol {
  /** ช่องของแบบฟอร์มบันทึก (body) — ref = ชื่อช่อง id · accounts.x = บัญชีของสินค้าบริการ */
  key: string; th: string; aliases: string[]; need: ImportNeed; when?: string; dflt?: string; hint: string; example: string;
  format?: 'text' | 'number' | 'int' | 'bool' | 'date' | 'enum'; values?: Record<string, string>; ref?: MasterRef;
}
export type MasterKind = 'customer' | 'supplier' | 'stock' | 'service' | 'asset';
export interface MasterImportKind { path: string; kind: MasterKind; label: string; menu: string; route: string; columns: MasterCol[] }

const t = (key: string, th: string, hint: string, o: Partial<MasterCol> = {}): MasterCol => ({ key, th, aliases: [], need: 'opt', hint, example: '', ...o });
const YES_NO = 'ใช่ / ไม่ใช่ (Y/N)';
const STATUS = t('status', 'สถานะ', 'ใช้งาน หรือ เลิกใช้', { format: 'enum', values: { 'ใช้งาน': 'A', 'เลิกใช้': 'I' }, dflt: 'ค่าเริ่มต้น = ใช้งาน', aliases: ['status'] });
const ADDR: MasterCol[] = [
  t('address_1', 'ที่อยู่ 1', 'บรรทัดที่ 1 ของที่อยู่ (ไม่เกิน 100 ตัว)', { aliases: ['ที่อยู่', 'address'] }), t('address_2', 'ที่อยู่ 2', 'บรรทัดที่ 2'), t('address_3', 'ที่อยู่ 3', 'บรรทัดที่ 3'),
  t('zip_code', 'รหัสไปรษณีย์', '5 หลัก', { aliases: ['ไปรษณีย์'] }),
  t('addr_no', 'เลขที่', 'แยกช่องที่อยู่ (ไม่บังคับ)'), t('addr_moo', 'หมู่', ''), t('addr_village', 'หมู่บ้าน', ''), t('addr_building', 'อาคาร', ''), t('addr_room', 'ห้อง', ''), t('addr_floor', 'ชั้น', ''),
  t('addr_soi', 'ซอย', ''), t('addr_road', 'ถนน', ''), t('addr_geo_code', 'รหัสตำบล', 'รหัสตำบล/แขวง 6 หลักตามรายการของกรมการปกครอง (ไม่บังคับ)'),
];
const PARTY = (w: string, cust: boolean): MasterCol[] => [
  t('code', `รหัส${w}`, `ไม่เกิน 20 ตัว · ว่าง = ออกรหัสให้ต่อจากรหัสล่าสุด · รหัสที่มีแล้ว = ข้าม (หรือแก้เมื่อติ๊ก "แก้ข้อมูลรหัสเดิมด้วย")`, { aliases: ['รหัส', 'code'], dflt: 'ค่าเริ่มต้น = ออกรหัสอัตโนมัติ', example: cust ? 'C9001' : 'S9001' }),
  t('title', 'คำนำหน้า', 'เช่น บริษัท ห้างหุ้นส่วนจำกัด คุณ'),
  t('name', `ชื่อ${w}`, 'ไม่เกิน 120 ตัว', { need: 'req', aliases: ['ชื่อ', 'name'], example: cust ? 'บริษัท ตัวอย่าง จำกัด' : 'ร้านตัวอย่าง' }),
  t('name_en', 'ชื่ออังกฤษ', ''),
  t('tax_id', 'เลขผู้เสียภาษี', '13 หลัก (มีขีดได้) — ตรวจหลักตรวจสอบ · ห้ามซ้ำ (เลข + สาขาเดียวกัน)', { aliases: ['เลขประจำตัวผู้เสียภาษี', 'taxid'] }),
  t('tax_branch_no', 'สาขา', '5 หลัก สำนักงานใหญ่ = 00000', { aliases: ['เลขที่สาขา', 'สาขาที่'], dflt: 'ค่าเริ่มต้น = 00000' }),
  ...ADDR,
  t('phone', 'โทรศัพท์', '', { aliases: ['โทร', 'เบอร์โทร'] }), t('email', 'อีเมล', '', { aliases: ['email'] }), t('contact', 'ผู้ติดต่อ', ''), t('remark', 'หมายเหตุ', ''),
  STATUS,
  t('on_hold', cust ? 'ระงับการขาย' : 'ระงับการจ่าย', YES_NO, { format: 'bool', dflt: 'ค่าเริ่มต้น = ไม่ใช่' }), t('on_hold_reason', 'เหตุผลที่ระงับ', ''),
  t(cust ? 'customer_type' : 'supplier_type', cust ? 'ประเภทลูกค้า' : 'ประเภทผู้จำหน่าย', 'รหัสประเภท (ไม่เกิน 4 ตัว)'),
  t(cust ? 'ar_account_id' : 'ap_account_id', cust ? 'บัญชีลูกหนี้' : 'บัญชีเจ้าหนี้', 'เลขที่บัญชีในผังบัญชี · ว่าง = ตามค่าเริ่มต้นของบริษัท', { ref: 'account' }),
  ...(cust ? [t('salesperson_id', 'พนักงานขาย', 'รหัสหรือชื่อพนักงานขาย', { ref: 'salesperson' }), t('sales_area_code', 'เขตการขาย', 'รหัสเขตการขาย')] : []),
  t('ship_via_code', 'ขนส่งโดย', 'รหัสวิธีขนส่ง'),
  t('credit_days', 'เครดิต (วัน)', 'จำนวนวัน', { format: 'int', aliases: ['เครดิต'] }), t('payment_terms', 'เงื่อนไขการชำระ', ''),
  ...(cust ? [t('price_level', 'ระดับราคา', '1–5 (ราคาขายที่ใช้) · 0 = ไม่ระบุ', { format: 'enum', values: { 0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }, dflt: 'ค่าเริ่มต้น = 1' })] : []),
  t('price_type', 'ประเภทราคา', '0 ยกเว้นภาษี · 1 รวมภาษี · 2 แยกภาษี', { format: 'enum', values: { 0: '0', 1: '1', 2: '2' } }),
  ...(cust ? [] : [t('vat_rate', 'อัตราภาษี %', 'เช่น 7', { format: 'number' })]),
  t('discount_text', 'ส่วนลด', 'เช่น 5% หรือ 100'), t('credit_limit', 'วงเงินเครดิต', 'จำนวนเงิน', { format: 'number' }),
  t('wht_form', 'แบบ ภ.ง.ด.', '3 หรือ 53'), ...(cust ? [] : [t('wht_income_desc', 'ประเภทเงินได้', 'เช่น ค่าบริการ')]),
  t('wht_rate', 'อัตราหัก ณ ที่จ่าย %', '0–100', { format: 'number' }),
  ...(cust ? [t('wht_category', 'หมวดภาษีหัก ณ ที่จ่าย', 'รหัสหมวด')] : []),
  t('wht_condition', 'เงื่อนไขการหักภาษี', '1 หัก ณ ที่จ่าย · 2 ออกให้ตลอดไป · 3 ออกให้ครั้งเดียว', { format: 'enum', values: { 1: '1', 2: '2', 3: '3' }, ...(cust ? { dflt: 'ค่าเริ่มต้น = 1' } : {}) }),
];
const ITEM = (service: boolean): MasterCol[] => [
  t('code', service ? 'รหัสบริการ' : 'รหัสสินค้า', 'ตามรูปแบบรหัสสินค้าของบริษัท · ว่าง = ออกรหัสให้ตามรูปแบบ · รหัสที่มีแล้ว = ข้าม (หรือแก้เมื่อติ๊ก)', { aliases: ['รหัส', 'code'], dflt: 'ค่าเริ่มต้น = ออกรหัสอัตโนมัติ' }),
  t('barcode', 'บาร์โค้ด', 'ไม่ซ้ำกับสินค้าอื่น'),
  t('name_th', service ? 'ชื่อบริการ' : 'ชื่อสินค้า', 'ชื่อไทย ไม่เกิน 120 ตัว', { need: 'req', aliases: ['ชื่อ', 'ชื่อไทย', 'name'], example: service ? 'ค่าบริการติดตั้ง' : 'สินค้าตัวอย่าง' }),
  t('name_en', 'ชื่ออังกฤษ', ''), STATUS,
  t('category_code', 'หมวดสินค้า', 'รหัสหมวด'), t('item_level', 'ระดับสินค้า', ''), t('packing', 'ขนาดบรรจุ', ''), t('remark', 'หมายเหตุ', ''),
  ...(service ? [
    t('accounts.revenue', 'บัญชีรายได้', 'เลขที่บัญชีรายได้ค่าบริการ', { need: 'req', ref: 'account' }),
    t('accounts.revenue_return', 'บัญชีรับคืน/ลดหนี้', 'เลขที่บัญชี (ไม่บังคับ)', { ref: 'account' }),
    t('accounts.cost_dr', 'บัญชีต้นทุนบริการ (Dr)', 'ต้องมีถ้าใส่ราคาทุน', { ref: 'account', need: 'cond', when: 'มีราคาทุน' }),
    t('accounts.cost_cr', 'บัญชีต้นทุนบริการ (Cr)', 'ต้องมีถ้าใส่ราคาทุน', { ref: 'account', need: 'cond', when: 'มีราคาทุน' }),
  ] : [
    t('account_group_id', 'กลุ่มบัญชีสินค้า', 'รหัสกลุ่มบัญชีสินค้า (เริ่มระบบ › กลุ่มบัญชีสินค้า)', { ref: 'item_group' }),
  ]),
  t('base_unit_id', 'หน่วยนับ', 'รหัสหรือชื่อหน่วยย่อย', service ? { ref: 'unit' } : { ref: 'unit', need: 'req', example: 'ชิ้น' }),
  t('count_unit_id', 'หน่วยนับสต๊อก', 'รหัสหรือชื่อหน่วย', { ref: 'unit' }), t('count_factor', 'ตัวคูณหน่วยนับสต๊อก', 'กี่หน่วยย่อย', { format: 'number' }),
  t('purchase_unit_id', 'หน่วยซื้อ', 'รหัสหรือชื่อหน่วย', { ref: 'unit' }), t('purchase_factor', 'ตัวคูณหน่วยซื้อ', 'กี่หน่วยย่อย', { format: 'number' }),
  t('sales_unit_id', 'หน่วยขาย', 'รหัสหรือชื่อหน่วย', { ref: 'unit' }), t('sales_factor', 'ตัวคูณหน่วยขาย', 'กี่หน่วยย่อย', { format: 'number' }),
  t('std_cost', 'ราคาทุน', 'ราคาทุนมาตรฐานต่อหน่วยย่อย', { format: 'number' }),
  ...[1, 2, 3, 4, 5].map((n) => t(`price_${n}`, `ราคาขาย ${n}`, 'ต่อหน่วยย่อย', { format: 'number', ...(n === 1 ? { aliases: ['ราคาขาย'] } : {}) })),
  t('vat_code', 'ประเภท VAT', '1 มี VAT · 0 ยกเว้น · 2 อัตรา 0%', { format: 'enum', values: { 0: '0', 1: '1', 2: '2' } }),
  ...(service ? [] : [t('allow_negative', 'ขายติดลบได้', 'Y ได้ · N ไม่ได้ · A ตามค่าของบริษัท', { format: 'enum', values: { Y: 'Y', N: 'N', A: 'A' } })]),
  t('default_supplier_id', 'ผู้จำหน่ายประจำ', 'รหัสหรือชื่อผู้จำหน่าย', { ref: 'supplier' }),
  t('udf_1', 'ฟิลด์เพิ่มเติม 1', 'ไม่เกิน 4 ตัว'), t('udf_2', 'ฟิลด์เพิ่มเติม 2', 'ไม่เกิน 4 ตัว'), t('udf_3', 'ฟิลด์เพิ่มเติม 3', 'ไม่เกิน 15 ตัว'), t('udf_4', 'ฟิลด์เพิ่มเติม 4', 'ไม่เกิน 30 ตัว'),
  t('udf_date_1', 'วันที่เพิ่มเติม 1', 'วว/ดด/ปปปป', { format: 'date' }), t('udf_date_2', 'วันที่เพิ่มเติม 2', 'วว/ดด/ปปปป', { format: 'date' }), t('udf_num_1', 'ตัวเลขเพิ่มเติม', '', { format: 'number' }),
];
/** ช่องของทรัพย์สินที่ใช้คิดค่าเสื่อม — แก้ไม่ได้ทางนำเข้าเมื่อคิดค่าเสื่อมลงบัญชีแล้ว (HANDOFF 173 ข้อ 7) */
export const ASSET_DEPR_KEYS = ['account_group_id', 'is_depreciable', 'purchase_date', 'cost', 'salvage_value', 'method', 'start_date', 'useful_life_years', 'rate', 'depr_monthly', 'accum_depr_bf', 'accum_bf_date', 'manual_depr', 'manual_depr_to'];
const ASSET: MasterCol[] = [
  t('code', 'รหัสทรัพย์สิน', 'ไม่เกิน 30 ตัว (ตัวพิมพ์ใหญ่) · ว่าง = ออกรหัสให้ · รหัสที่มีแล้ว = ข้าม (หรือแก้เมื่อติ๊ก)', { aliases: ['รหัส', 'code'], dflt: 'ค่าเริ่มต้น = ออกรหัสอัตโนมัติ' }),
  t('name_th', 'ชื่อทรัพย์สิน', 'ไม่เกิน 120 ตัว', { need: 'req', aliases: ['ชื่อ', 'name'], example: 'เครื่องคอมพิวเตอร์' }),
  t('name_en', 'ชื่ออังกฤษ', ''), t('category_code', 'หมวดทรัพย์สิน', 'รหัสหมวด'),
  t('account_group_id', 'กลุ่มบัญชีทรัพย์สิน', 'รหัสกลุ่มบัญชีทรัพย์สิน (เริ่มระบบ › กลุ่มบัญชีทรัพย์สิน)', { need: 'req', ref: 'asset_group' }),
  t('serial_no', 'หมายเลขเครื่อง', ''), t('department_id', 'แผนก', 'รหัสหรือชื่อแผนก', { ref: 'department' }),
  t('is_depreciable', 'คิดค่าเสื่อม', YES_NO, { format: 'bool', dflt: 'ค่าเริ่มต้น = ใช่' }),
  t('purchase_date', 'วันที่ซื้อ', 'วว/ดด/ปปปป', { need: 'req', format: 'date' }),
  t('cost', 'ราคาทุน', 'จำนวนเงิน', { need: 'req', format: 'number', example: '35000' }),
  t('salvage_value', 'ราคาซาก', 'ค่าเริ่มต้น 1 บาท', { format: 'number', dflt: 'ค่าเริ่มต้น = 1' }),
  t('method', 'วิธีคิดค่าเสื่อม', '1 เส้นตรง · 2 ลดยอด · 0 ไม่คิด', { format: 'enum', values: { 0: '0', 1: '1', 2: '2', 'เส้นตรง': '1', 'ลดยอด': '2', 'ไม่คิด': '0' }, dflt: 'ค่าเริ่มต้น = 1 เส้นตรง' }),
  t('start_date', 'วันที่เริ่มคิดค่าเสื่อม', 'วว/ดด/ปปปป', { need: 'req', format: 'date', aliases: ['วันที่เริ่มใช้'] }),
  t('useful_life_years', 'อายุการใช้งาน (ปี)', 'จำนวนปี (หรือใส่อัตรา)', { format: 'int', aliases: ['อายุการใช้งาน'] }),
  t('rate', 'อัตราค่าเสื่อม %', 'ต่อปี (ว่าง = 100 ÷ อายุ)', { format: 'number' }),
  t('depr_monthly', 'คิดรายเดือน', YES_NO, { format: 'bool', dflt: 'ค่าเริ่มต้น = ใช่' }),
  t('accum_depr_bf', 'ค่าเสื่อมสะสมยกมา', 'จำนวนเงิน (ถึงก่อนวันที่ยกมา)', { format: 'number' }),
  t('accum_bf_date', 'วันที่ยกมา', 'ต้องมีถ้ามีค่าเสื่อมสะสมยกมา', { format: 'date', need: 'cond', when: 'มีค่าเสื่อมสะสมยกมา' }),
  t('manual_depr', 'ค่าเสื่อมที่ป้อนเอง', 'จำนวนเงิน', { format: 'number' }), t('manual_depr_to', 'ป้อนเองถึงวันที่', 'วว/ดด/ปปปป', { format: 'date' }),
];

export const MASTER_IMPORT_KINDS: MasterImportKind[] = [
  { path: 'customers', kind: 'customer', label: 'ลูกค้า', menu: 'SA.CUS', route: '/ar/customers', columns: PARTY('ลูกค้า', true) },
  { path: 'suppliers', kind: 'supplier', label: 'ผู้จำหน่าย', menu: 'PU.SUP', route: '/ap/suppliers', columns: PARTY('ผู้จำหน่าย', false) },
  { path: 'items', kind: 'stock', label: 'สินค้า', menu: 'IC.ITEM', route: '/ic/items', columns: ITEM(false) },
  { path: 'services', kind: 'service', label: 'สินค้าบริการ', menu: 'IC.SRV', route: '/ic/services', columns: ITEM(true) },
  { path: 'fa-assets', kind: 'asset', label: 'ทรัพย์สิน', menu: 'FA.ASSET', route: '/fa/assets', columns: ASSET },
];
export const masterImportKindOf = (path: string) => MASTER_IMPORT_KINDS.find((k) => k.path === path) ?? null;

const BOOL: Record<string, boolean> = { 'ใช่': true, y: true, yes: true, '1': true, true: true, 'ไม่ใช่': false, 'ไม่': false, n: false, no: false, '0': false, false: false };
export interface MasterRow { row: number; code: string; values: Record<string, string | boolean | number> }
/**
 * ตาราง → แถวข้อมูลหลัก: ค่าที่ใส่เท่านั้น (ช่องว่างไม่อยู่ใน values = ไม่เปลี่ยน/ค่าเริ่มต้น) · รูปแบบผิด = ผิด บอกแถว/คอลัมน์ · รหัสซ้ำในแฟ้ม = ผิด
 */
export function mapMasterImport(rows: string[][], ys: YearSystem, K: MasterImportKind): { rows: MasterRow[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  // ไม่บังคับคอลัมน์ในแฟ้ม (แฟ้มแก้ข้อมูลใส่เฉพาะรหัส + ช่องที่จะแก้ได้) — ช่องที่ต้องมีของรายใหม่ตรวจรายแถวด้วยการบันทึกของหน้าจอ
  const h = findHeader(rows, K.columns.map((c) => ({ ...c, required: false })));
  if ('error' in h) return { rows: [], errors: [h.error] };
  const out: MasterRow[] = [];
  const seen = new Map<string, number>();
  let count = 0;
  for (let r = h.headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const n0 = errors.length;
    const values: MasterRow['values'] = {};
    for (const c of K.columns) {
      const i = h.cols.get(c.key);
      const v = i === undefined ? '' : String(row[i] ?? '').trim();
      if (!v || c.key === 'code') continue;
      const bad = (why: string) => errors.push({ row: no, message: `${c.th} "${v}" ${why}` });
      if (c.format === 'number') { const x = importNumber(v); if (x === null) bad('ไม่ใช่ตัวเลข'); else values[c.key] = x; }
      else if (c.format === 'int') { const x = importNumber(v); if (x === null || !Number.isInteger(Number(x))) bad('ต้องเป็นจำนวนเต็ม'); else values[c.key] = Number(x); }
      else if (c.format === 'date') { const x = importDate(v, ys); if (!x) bad('ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป'); else values[c.key] = x; }
      else if (c.format === 'bool') { const x = BOOL[v.toLowerCase()]; if (x === undefined) bad(`ใช้ ${YES_NO}`); else values[c.key] = x; }
      else if (c.format === 'enum') { const x = c.values![v] ?? Object.values(c.values!).find((y) => y.toLowerCase() === v.toLowerCase()); if (x === undefined) bad(`ใช้ ${c.hint}`); else values[c.key] = x; }
      else values[c.key] = v;
    }
    const code = (() => { const i = h.cols.get('code'); return i === undefined ? '' : String(row[i] ?? '').trim(); })();
    if (code) {
      const k = code.toUpperCase(), at = seen.get(k);
      if (at) errors.push({ row: no, message: `รหัส ${code} ซ้ำกับแถว ${at} ในแฟ้ม — หนึ่งรหัสใส่แถวเดียว` });
      else seen.set(k, no);
    }
    if (errors.length > n0) continue;
    out.push({ row: no, code, values });
  }
  if (!out.length && !errors.length) errors.push({ row: h.headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { rows: out, errors };
}
