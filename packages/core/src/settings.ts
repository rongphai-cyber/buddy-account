/**
 * ค่าเริ่มต้นแต่ละระบบ — คู่มือ Express บทที่ 5 (เริ่มระบบ › 1. กำหนดค่าเริ่มต้นต่าง ๆ) S-SET-02/03/05/07/09/10/11
 * แหล่งเดียวของ: ป้ายบนหน้าจอ (เลขข้อตามคู่มือ), ชนิด, ค่าเริ่มต้นตามคู่มือ, ฟิลด์ใน ISINFO ของ Express (ใช้ตอนนำเข้า)
 * server ใช้ sync ตาราง sys_setting_def และตรวจค่าก่อนบันทึก · importer อ่านจาก settings_catalog.json ที่สร้างจากไฟล์นี้
 *
 * แปลงค่าจาก ISINFO (from): yn = Y/T/1 เป็นจริง · num · int · str · level = 0–9 หรือว่าง · yearthai = '1' พ.ศ.
 * perpetual = Y → PERPETUAL · list:F1,F2 = ตัวเลขหลายช่อง · tiers · udf · petty — ดู tools/express-import/migrate_express.py
 */
export type SettingType =
  | { t: 'bool' }
  | { t: 'int'; min: number; max: number }
  | { t: 'decimal'; min: number; max: number }
  | { t: 'select'; options: Array<[string, string]> }
  | { t: 'text'; max: number }
  | { t: 'mask'; max: number }
  | { t: 'level' }                         // ระดับอนุมัติ 0–9 หรือว่าง (= ไม่ต้องขออนุมัติ)
  | { t: 'days'; n: number }               // ช่วงจำนวนวัน n ช่อง เรียงจากน้อยไปมาก
  | { t: 'tiers' }                         // ระดับวงเงินขายเชื่อ 5 แถว {amount, level}
  | { t: 'udf' }                           // ฟิลด์เพิ่มเติมของสินค้า (ใช้? ชื่อไทย ชื่ออังกฤษ)
  | { t: 'petty' };                        // คอลัมน์รายงานเงินสดย่อย (ชื่อไทย อังกฤษ บัญชี)

export interface SettingDef {
  key: string; module: string; no: string; label: string; type: SettingType; default: unknown;
  hint?: string; from?: string; assumed?: boolean;
}
export interface SettingSection { code: string; screen: string; title: string; defs: SettingDef[] }

const S = (key: string, no: string, label: string, type: SettingType, def: unknown, from?: string, extra: Partial<SettingDef> = {}): SettingDef =>
  ({ key, module: key.split('.')[0]!.toUpperCase(), no, label, type, default: def, from, ...extra });
const bool: SettingType = { t: 'bool' }, level: SettingType = { t: 'level' };
const sel = (...options: Array<[string, string]>): SettingType => ({ t: 'select', options });
const SEARCH = sel(['CODE', 'ตามรหัส'], ['NAME', 'ตามชื่อ']);
const UDF_KEYS = ['dat1', 'dat2', 'num1', 'str1', 'str2', 'str3', 'str4'] as const;
export const UDF_LABELS: Record<(typeof UDF_KEYS)[number], string> = { dat1: '20. วันที่1', dat2: '21. วันที่2', num1: '22. ตัวเลข', str1: '23. ข้อความ1 (4 ตัวอักษร)', str2: '24. ข้อความ2 (4 ตัวอักษร)', str3: '25. ข้อความ3 (15 ตัว)', str4: '26. ข้อความ4 (30 ตัว)' };

export const SETTING_SECTIONS: SettingSection[] = [
  { code: 'GEN', screen: 'S-SET-02', title: 'เรื่องทั่วไป', defs: [
    S('gen.year_system', '1.', 'ระบบปีที่ใช้', sel(['B', 'พุทธศักราช'], ['C', 'คริสต์ศักราช']), 'B', 'YEARTHAI:yearthai'),
    S('gen.vat_rate', '2.', 'อัตราภาษีมูลค่าเพิ่ม (%)', { t: 'decimal', min: 0, max: 30 }, 7, 'VATRAT:num', { hint: 'ใส่ให้อัตโนมัติตอนเปิดบิลขาย' }),
    S('gen.price_type', '3.', 'ประเภทราคาขาย', sel(['1', 'ราคารวมภาษี'], ['2', 'ราคาไม่รวมภาษีมูลค่าเพิ่ม']), '2', 'FLGVAT:str', { hint: 'ขายทั้งสองแบบ: ตั้งแบบหนึ่งแล้วแก้ตอนเปิดบิล' }),
    S('tax.input_vat_prorate', '4.', 'เฉลี่ยภาษีซื้อหรือไม่', sel(['N', 'N ไม่เฉลี่ย'], ['Y', 'Y เฉลี่ย'], ['A', 'A ถามตอนเพิ่มเอกสาร']), 'N', 'PVATPRORAT:str', { hint: 'กิจการที่มีทั้งรายได้ยกเว้นภาษีและเสีย VAT (หน้า 58)' }),
    S('tax.prorate_claimable', '', 'อัตราที่ขอคืนได้ (%)', { t: 'decimal', min: 0, max: 100 }, 0, 'PVAT_RF:num'),
    S('tax.prorate_nonclaimable', '', 'อัตราที่ขอคืนไม่ได้ (%)', { t: 'decimal', min: 0, max: 100 }, 0, 'PVAT_NRF:num'),
    S('gen.approve_level', '5.', 'รับรองเอกสาร ต้องขออนุมัติระดับ', level, null, 'APPROV_LEV:level', { hint: 'ว่าง/0 = ไม่ต้องรับรองเอกสาร · กำหนดเฉพาะรายเอกสารได้ที่เลขที่เอกสาร' }),
    S('gen.approve_method', '6.', 'วิธีการพิมพ์ หรือรับรองเอกสาร', sel(['', 'อะไรก่อนก็ได้'], ['1', '1 พิมพ์ก่อนรับรอง'], ['2', '2 รับรองก่อนพิมพ์']), '1', 'APPROV_MET:str'),
    S('gen.reprint_level', '7.', 'พิมพ์เอกสารซ้ำ ต้องขออนุมัติระดับ', level, null, 'REPRN_LEV:level', { hint: 'กันพิมพ์ใบกำกับภาษีซ้ำ' }),
    S('gen.vat_in_item', '8.', 'แยกประเภท VAT ที่รายการสินค้า', bool, false, 'VAT_INITEM:yn', { hint: 'ใบกำกับเดียวมีทั้งสินค้ามี VAT และยกเว้น VAT' }),
    S('gen.allow_blank_party_tax_id', '', 'ยอมให้เลขประจำตัวผู้เสียภาษีในทะเบียนลูกค้า/ผู้จำหน่ายว่างได้', bool, false, undefined, { hint: 'คู่มือบทที่ 5 รายละเอียดกิจการ ข้อ 5.3 · ไม่ติ๊ก = บังคับป้อน' }),
    S('gen.idle_lock_minutes', '', 'ตั้งเวลาพักหน้าจอ (นาที)', { t: 'int', min: 0, max: 480 }, 0, 'SAVSCRTIME:int', { hint: '0 = ไม่ล็อก (คู่มือหน้า 59)' }),
    S('gen.link_gl', '', 'เชื่อมต่อระบบบัญชี (ลงบัญชีอัตโนมัติจากเอกสาร)', bool, true, 'LINKGL:yn', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
    S('gen.use_department', '', 'ใช้แผนก', bool, true, 'USEDEP:yn'),
    S('gen.use_project', '', 'ใช้โครงการ/Job', bool, false, 'USEJOB:yn'),
  ] },
  { code: 'IC', screen: 'S-SET-03', title: 'ระบบสินค้าคงเหลือ', defs: [
    S('ic.item_code_mask', '1.', 'รูปแบบของรหัสสินค้า', { t: 'mask', max: 20 }, '99-!!!!-!!!!!!', 'STPICT:str', { hint: '9 = ตัวเลข · X = ตัวอักษรใด ๆ · ! = เหมือน X แต่เป็นตัวใหญ่ · อื่น ๆ = ตัวคั่น' }),
    S('ic.search_by', '2.', 'ค้นหาสินค้า', SEARCH, 'CODE', 'STPREFER:prefer', { assumed: true }),
    S('ic.posting_method', '4.', 'บันทึกบัญชีสินค้าแบบ', sel(['PERPETUAL', 'Perpetual (ต่อเนื่อง)'], ['PERIODIC', 'Periodic (สิ้นงวด)']), 'PERPETUAL', 'ISPERPETUA:perpetual', { hint: 'วิธีคำนวณต้นทุนกำหนดที่กลุ่มบัญชีสินค้า' }),
    S('ic.decimals_price', '5.', 'ทศนิยมของราคาสินค้า (หลัก)', { t: 'int', min: 0, max: 4 }, 3, 'DSIMLPRI:int'),
    S('ic.decimals_qty', '6.', 'ทศนิยมของจำนวนสินค้า (หลัก)', { t: 'int', min: 0, max: 4 }, 1, 'DSIMLQTY:int'),
    S('ic.decimals_factor', '7.', 'ทศนิยมของตัวคูณเป็นหน่วยย่อย (หลัก)', { t: 'int', min: 0, max: 4 }, 1, 'DSIMLFAC:int'),
    S('ic.edit_unit_stock', '8.', 'ปรับหน่วยนับรับ/จ่ายได้ (รายการประจำวันสินค้า)', bool, true, 'TEDITQU:yn'),
    S('ic.edit_factor_stock', '', 'ปรับตัวคูณ (รายการประจำวันสินค้า)', bool, true, 'TEDITFAC:yn'),
    S('ic.allow_negative', '9.', 'ยอดคงเหลือสินค้าติดลบได้', sel(['Y', 'Y ยอม'], ['N', 'N ไม่ยอม'], ['A', 'A ยอมเมื่อได้รับอนุมัติ']), 'Y', 'NEGALLOW:str'),
    S('ic.negative_approve_level', '10.', 'ตัดสินค้าติดลบ ขออนุมัติระดับ', level, null, 'NEGAUTH:level', { hint: 'ใช้เมื่อข้อ 9 = A' }),
    S('ic.negative_check_level', '11.', 'ระดับการตรวจสอบยอดสินค้าติดลบ', sel(['0', '0 ไม่ตรวจ'], ['1', '1 ตรวจยอด ณ ปัจจุบัน'], ['2', '2 ตรวจทั้ง ณ วันที่ตัดและ ณ ปัจจุบัน']), '0', 'CHKNEGLEV:str'),
    S('ic.any_warehouse', '12.', 'ยอมให้เก็บสินค้าได้ทุกคลัง', bool, true, 'ANYLOC:yn'),
    S('ic.cost_by_warehouse', '13.', 'ตัดต้นทุนสินค้าแยกตามคลัง', bool, true, 'LOC_COST:yn'),
    S('ic.main_warehouse', '14.', 'รหัสคลังสินค้าหลัก', { t: 'text', max: 10 }, '01', 'MAINLOC:str', { hint: 'คลังเริ่มต้นในรายการรับ-จ่าย (ตารางคลังสินค้า)' }),
    S('ic.show_pack_units', '15.', 'แสดงหน่วยใหญ่/หน่วยย่อย ในรายงานสินค้าคงเหลือ', bool, false, 'USEPACKING:yn', { assumed: true }),
    S('ic.edit_last_prices', '16.', 'แก้ไขราคาซื้อ/ขายล่าสุดได้ (หน้าจอรายละเอียดสินค้า)', bool, false, 'E_LPURSAL:yn'),
    S('ic.warn_below_reorder', '17.', 'ขาย/เบิกต่ำกว่าจุดสั่งซื้อ ให้เตือนทันที', bool, false, 'ST_LT_REOP:yn'),
    S('ic.aging_days', '18.', 'ช่วงวิเคราะห์อายุสินค้า ช่วงที่ 1/2/3 (วัน)', { t: 'days', n: 3 }, [30, 60, 90], 'STAGE1,STAGE2,STAGE3:list'),
    S('ic.udf', '19.', 'ชื่อฟิลด์เพิ่มเติม (รายละเอียดสินค้า)', { t: 'udf' }, { dat1: { use: true, th: 'วันหมดอายุ', en: 'Expire Date' } }, 'ST_:udf'),
    S('ic.edit_item_name_stock', '27.', 'เปลี่ยนชื่อสินค้าในเอกสารรายการประจำวันสินค้า', bool, false),
    S('ic.use_barcode', '28.', 'ใช้รหัสบาร์โค้ดในรายละเอียดสินค้า', bool, false, 'USEBARCOD:yn'),
    S('ic.use_count_unit', '', 'ใช้หน่วยตรวจนับ', bool, true, 'USE_CQU:yn', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
  ] },
  { code: 'AR', screen: 'S-SET-05', title: 'ระบบขายและลูกหนี้', defs: [
    S('ar.search_by', '1.', 'ค้นหาลูกค้า', SEARCH, 'NAME', 'ARPREFER:prefer', { assumed: true }),
    S('ar.edit_item_name', '2.', 'เปลี่ยนชื่อสินค้าในบิลขายได้', bool, true, 'ED_SSTKDES:yn'),
    S('ic.edit_unit_sales', '3.', 'ปรับหน่วยนับขายได้', bool, true, 'SEDITQU:yn'),
    S('ic.edit_factor_sales', '', 'ปรับตัวคูณได้ (ขาย)', bool, true, 'SEDITFAC:yn'),
    S('ar.change_sales_price', '4.', 'แก้ไขราคาต่อหน่วยขายได้', sel(['Y', 'Y ได้'], ['N', 'N ไม่ได้'], ...Array.from({ length: 10 }, (_, i): [string, string] => [String(i), `ระดับ ${i} ขึ้นไป`])), 'Y', 'CHGSALPR:str', { hint: 'ไม่อนุญาต = ข้ามช่องราคา ยกเว้นสินค้าที่ยังไม่ตั้งราคา' }),
    S('ar.warn_below_cost', '5.', 'ขายต่ำกว่าทุนให้เตือนด้วย', bool, true, 'LOSESAL:yn'),
    S('ar.manual_line_order', '6.', 'ป้อนลำดับรายการสินค้าได้เอง', bool, false, 'INSERTIT:yn'),
    S('ar.credit_note_deduct', '7.', 'วิธีการหักยอดใบลดหนี้/รับคืน', sel(['1', '1 หักจากใบกำกับที่อ้างถึง'], ['2', '2 เก็บไว้หักตอนรับเงิน']), '1', 'CNDEDUCT:str'),
    S('ar.so_credit_lock', '8.', 'ล็อคเรื่องขายเกินวงเงินที่ใบสั่งขาย', bool, true, 'SO_CR_LOCK:yn'),
    S('ar.allow_over_credit', '9.', 'ลูกค้าเกินวงเงิน ยอมให้ออกเอกสารไปก่อน', bool, false, 'OVRCRALLOW:yn', { hint: 'ติ๊ก = ออกบิลได้แต่พิมพ์ไม่ได้จนกว่าอนุมัติ' }),
    S('ar.so_require_warehouse', '10.', 'บังคับให้ป้อนคลังสินค้าที่ใบสั่งขาย', bool, false, 'SO_LOGLOC:yn'),
    S('ar.service_vat_basis', '11.', 'ภาระภาษีขาย (สินค้าบริการ)', sel(['1', 'เกณฑ์สิทธิ'], ['2', 'เกณฑ์เงินสด'], ['3', 'ให้ผู้ใช้เลือกเองตอนเปิดบิล']), '3', 'SRV_VATTYP:str'),
    S('ar.aging_overdue', '12.', 'ช่วงวิเคราะห์อายุลูกหนี้ — เกินกำหนด (วัน)', { t: 'days', n: 3 }, [7, 15, 30], 'AROVR1,AROVR2,AROVR3:list'),
    S('ar.aging_due', '', 'ช่วงวิเคราะห์อายุลูกหนี้ — ยังไม่ครบกำหนด (วัน)', { t: 'days', n: 2 }, [30, 60], 'ARDUE1,ARDUE2:list'),
    S('ar.credit_tiers', '13.', 'ระดับวงเงินขายเชื่อ (ไม่คุมระดับวงเงิน ให้เป็น 0)', { t: 'tiers' }, [], 'CRLINE_:tiers'),
    S('ar.over_credit_level', '14.', 'ขายเกินวงเงิน ขออนุมัติระดับ', level, 9, 'OVRCRAUTH:level', { hint: 'ใช้เมื่อไม่ได้กำหนดข้อ 13' }),
    S('ar.lock_so_closed_period', '15.', 'ห้ามแก้ใบสั่งขายในงวดที่ปิดแล้ว', bool, false),
    S('ar.quote_price_always', '16.', 'ดึงราคาขายจากใบเสนอราคาเสมอ ถ้ายังอยู่ในกำหนดยืนราคา (ไม่ติ๊ก = ถามก่อน)', bool, false),
    S('ar.skip_bill_to', '17.', "ข้ามช่อง 'Bill to'", bool, false),
  ] },
  { code: 'AP', screen: 'S-SET-07', title: 'ระบบซื้อและเจ้าหนี้', defs: [
    S('ap.search_by', '1.', 'ค้นหาผู้จำหน่าย', SEARCH, 'NAME', 'APPREFER:prefer', { assumed: true }),
    S('ap.edit_item_name', '2.', 'เปลี่ยนชื่อสินค้าในบิลซื้อได้', bool, true, 'ED_PSTKDES:yn'),
    S('ic.edit_unit_purchase', '3.', 'ปรับหน่วยนับซื้อได้', bool, true, 'PEDITQU:yn'),
    S('ic.edit_factor_purchase', '', 'ปรับตัวคูณได้ (ซื้อ)', bool, true, 'PEDITFAC:yn'),
    S('ap.debit_note_deduct', '4.', 'วิธีการหักยอดใบลดหนี้/ส่งคืน', sel(['1', '1 หักจากใบรับที่อ้างถึง'], ['2', '2 เก็บไว้หักตอนจ่ายเงิน']), '2', 'DNDEDUCT:str'),
    S('ap.aging_overdue', '5.', 'ช่วงวิเคราะห์อายุเจ้าหนี้ — เกินกำหนด (วัน)', { t: 'days', n: 3 }, [15, 30, 60], 'APOVR1,APOVR2,APOVR3:list'),
    S('ap.aging_due', '', 'ช่วงวิเคราะห์อายุเจ้าหนี้ — ยังไม่ครบกำหนด (วัน)', { t: 'days', n: 2 }, [30, 60], 'APDUE1,APDUE2:list'),
    S('ap.lock_po_closed_period', '6.', 'ห้ามแก้ใบสั่งซื้อในงวดที่ปิดแล้ว', bool, false),
    S('ap.skip_bill_to', '7.', "ข้ามช่อง 'Bill be'", bool, false),
  ] },
  { code: 'FN', screen: 'S-SET-09', title: 'ระบบการเงินและเงินฝากธนาคาร', defs: [
    S('fn.auto_pass_cheque_paid', '1.', 'ผ่านเช็คจ่ายทันที', bool, false, 'PASPCQAUTO:yn', { hint: 'ไม่ติ๊ก = ต้องทำรายการผ่านเช็คจ่ายอีกครั้งจึงตัดบัญชีเงินฝาก' }),
    S('fn.default_deposit_bank', '2.', 'รหัสธนาคารที่นำเช็คฝากเป็นประจำ', { t: 'text', max: 10 }, 'S1', 'BNKDEP:str'),
    S('fn.default_paid_bank', '', 'รหัสธนาคารที่สั่งจ่ายเช็คเป็นประจำ', { t: 'text', max: 10 }, 'C1', 'BNKPAID:str', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
    S('fn.wht_min_amount', '3.', 'ยอดเงินขั้นต่ำที่จะต้องหักภาษี ณ ที่จ่าย', { t: 'decimal', min: 0, max: 1e9 }, 1000, 'MINTAXAMT:num'),
    S('fn.wht_default_rate', '', 'อัตราหักภาษี ณ ที่จ่ายเริ่มต้น (%)', { t: 'decimal', min: 0, max: 100 }, 3, 'MINTAXRAT:num', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
    S('fn.social_security_no', '4.', 'เลขที่บัตรประกันสังคม', { t: 'text', max: 20 }, '', 'SOCIALID:str', { hint: 'พิมพ์ในหนังสือรับรองการหักภาษี ณ ที่จ่าย' }),
    S('fn.compensation_fund_no', '5.', 'เลขใบอนุญาตกองทุนทดแทน', { t: 'text', max: 20 }, '', 'POVDNTID:str'),
    S('fn.cheque_received_aging', '', 'ช่วงวิเคราะห์อายุเช็ครับ (วัน)', { t: 'days', n: 3 }, [15, 30, 60], 'QROVR1,QROVR2,QROVR3:list', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
    S('fn.cheque_paid_aging', '', 'ช่วงวิเคราะห์อายุเช็คจ่าย (วัน)', { t: 'days', n: 3 }, [15, 30, 60], 'QPOVR1,QPOVR2,QPOVR3:list', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
  ] },
  { code: 'GL', screen: 'S-SET-10', title: 'ระบบบัญชี', defs: [
    S('gl.account_mask', '1.', 'รูปแบบของรหัสบัญชี', { t: 'mask', max: 20 }, '9999-99', 'GLPICT:str', { hint: 'ผังบัญชีมาตรฐานใช้ 9999-99 — ศึกษาก่อนเปลี่ยน' }),
    S('gl.voucher_numbering', '2.', 'ลำดับเลขที่ใบสำคัญ (สมุดรายวัน)', sel(['0', '0 ป้อนเลขเอง'], ['1', '1 YMMDDxx'], ['2', '2 YMMxxxx'], ['3', '3 YYMMxxxx'], ['4', '4 YYMMDDxxx']), '4', 'GLRUNNING:str', { hint: 'ต่อท้ายตัวนำเลขที่ของสมุด เช่น JV · Y = เลขท้ายปี 1 หลัก, YY = 2 หลัก' }),
    S('gl.petty_cash_columns', '3–6.', 'รายการจ่ายเงินสดย่อย (หัวคอลัมน์รายงาน)', { t: 'petty' }, [], 'PT_STR:petty', { hint: 'รายการอื่นรวมในคอลัมน์ คชจ.อื่น ๆ · เปลี่ยนบัญชีภายหลังไม่กระทบข้อมูลเดิม' }),
  ] },
  { code: 'FA', screen: 'S-SET-11', title: 'ระบบทรัพย์สินถาวร', defs: [
    S('fa.asset_code_mask', '1.', 'รูปแบบของรหัสทรัพย์สิน', { t: 'mask', max: 20 }, '!!!!!!!!!!!!!!', 'FAPICT:str'),
    S('fa.depreciate_on_entry', '2.', 'คิดค่าเสื่อมขณะบันทึกทรัพย์สิน', sel(['true', 'คิดทันที'], ['false', 'ยังไม่คิด']), 'true', 'FADPRAUTO:ynstr', { hint: 'ตอนเริ่มระบบที่ป้อนทรัพย์สินจำนวนมาก ตั้ง "ยังไม่คิด" แล้วสั่งคำนวณทีเดียว' }),
    S('fa.depreciate_monthly', '3.', 'คิดค่าเสื่อม', sel(['true', 'รายเดือน'], ['false', 'รายปี']), 'true', 'FADPRMONLY:ynstr'),
    S('fa.depreciation_method', '', 'วิธีคิดค่าเสื่อมเริ่มต้น', { t: 'text', max: 2 }, '1', 'DPRMETHOD:str', { hint: 'ฟิลด์ใน ISINFO ที่ไม่อยู่บนหน้าจอบทที่ 5' }),
  ] },
];

export const SETTING_DEFS: SettingDef[] = SETTING_SECTIONS.flatMap((s) => s.defs);
export const SETTING_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));
/** ชนิดข้อมูลใน sys_setting_def.data_type */
export const settingDataType = (d: SettingDef) => ({ bool: 'bool', int: 'int', decimal: 'decimal', select: 'code', text: 'text', mask: 'text', level: 'int', days: 'json', tiers: 'json', udf: 'json', petty: 'json' } as const)[d.type.t];

/** ค่าเดิมที่เก็บไว้ก่อนมีหน้าจอนี้ (เช่น bool ของข้อที่คู่มือให้เลือก Y/N/A) → รูปแบบปัจจุบัน */
export function normalizeSetting(d: SettingDef, v: unknown): unknown {
  if (v === undefined) return d.default;
  if (d.type.t === 'select') {
    if (typeof v === 'boolean') return d.type.options.some(([k]) => k === 'Y') ? (v ? 'Y' : 'N') : String(v);
    return v === null ? '' : String(v);
  }
  if (d.type.t === 'days' && Array.isArray(v)) return v.map((x) => Number(x));
  return v;
}

/** ตรวจค่าก่อนบันทึก — คืนข้อความผิดพลาดภาษาไทย (บอกวิธีแก้) หรือ null */
export function validateSetting(d: SettingDef, v: unknown): string | null {
  const name = `${d.no ? d.no + ' ' : ''}${d.label}`;
  const ty = d.type;
  switch (ty.t) {
    case 'bool': return typeof v === 'boolean' ? null : `${name}: เลือกใช่/ไม่ใช่`;
    case 'int': case 'decimal': {
      const n = typeof v === 'number' ? v : Number(v);
      if (v === '' || v === null || !Number.isFinite(n)) return `${name}: ป้อนตัวเลข`;
      if (ty.t === 'int' && !Number.isInteger(n)) return `${name}: ป้อนจำนวนเต็ม`;
      return n < ty.min || n > ty.max ? `${name}: ต้องอยู่ระหว่าง ${ty.min.toLocaleString()} ถึง ${ty.max.toLocaleString()}` : null;
    }
    case 'select': return ty.options.some(([k]) => k === v) ? null : `${name}: เลือกจากรายการ (${ty.options.map(([k]) => k || 'ว่าง').join(' / ')})`;
    case 'text': return typeof v === 'string' && v.length <= ty.max ? null : `${name}: ข้อความยาวไม่เกิน ${ty.max} ตัวอักษร`;
    case 'mask': return typeof v === 'string' && v.trim().length > 0 && v.length <= ty.max && /[9X!]/i.test(v) ? null : `${name}: ป้อนรูปแบบด้วย 9 X ! และตัวคั่น ยาวไม่เกิน ${ty.max} ตัว เช่น 9999-99`;
    case 'level': return v === null || v === '' || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9) ? null : `${name}: ป้อนระดับ 0–9 หรือเว้นว่าง`;
    case 'days': {
      if (!Array.isArray(v) || v.length !== ty.n || v.some((x) => !Number.isInteger(x) || x <= 0 || x > 9999)) return `${name}: ป้อนจำนวนวัน ${ty.n} ช่อง (จำนวนเต็มบวก)`;
      return v.every((x, i) => i === 0 || x > v[i - 1]) ? null : `${name}: แต่ละช่วงต้องมากกว่าช่วงก่อนหน้า`;
    }
    case 'tiers': {
      if (!Array.isArray(v) || v.length > 5) return `${name}: กำหนดได้ไม่เกิน 5 ระดับ`;
      for (const [i, r] of v.entries()) {
        const t = r as { amount?: unknown; level?: unknown };
        if (!(typeof t.amount === 'number' && t.amount >= 0) || !(Number.isInteger(t.level) && (t.level as number) >= 0 && (t.level as number) <= 9)) return `${name}: ระดับ ${i + 1} ป้อนจำนวนเงิน ≥ 0 และระดับที่อนุมัติ 0–9`;
        if (i > 0 && (t.amount as number) <= ((v[i - 1] as { amount: number }).amount)) return `${name}: จำนวนเงินระดับ ${i + 1} ต้องมากกว่าระดับ ${i}`;
      }
      return null;
    }
    case 'udf': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${name}: รูปแบบไม่ถูกต้อง`;
      for (const [k, x] of Object.entries(v as Record<string, { use?: unknown; th?: unknown; en?: unknown }>)) {
        if (!(UDF_KEYS as readonly string[]).includes(k)) return `${name}: ไม่รู้จักฟิลด์ ${k}`;
        if (x.use && !String(x.th ?? '').trim()) return `${name}: ${UDF_LABELS[k as (typeof UDF_KEYS)[number]]} ที่ใช้ต้องมีชื่อภาษาไทย`;
      }
      return null;
    }
    case 'petty': {
      if (!Array.isArray(v) || v.length > 5) return `${name}: กำหนดได้ไม่เกิน 5 รายการ`;
      for (const [i, r] of v.entries()) { const p = r as { th?: unknown }; if (!String(p.th ?? '').trim()) return `${name}: ข้อความ ${i + 1} ต้องมีชื่อภาษาไทย`; }
      return null;
    }
  }
}

/**
 * ลำดับเลขที่ใบสำคัญ (คู่มือบทที่ 5 S-SET-10 ข้อ 2): ส่วนต้น + จำนวนหลักของเลขลำดับ
 * 1 YMMDDxx · 2 YMMxxxx · 3 YYMMxxxx · 4 YYMMDDxxx · 0 ป้อนเอง (null) — ปีตามระบบปีของบริษัท
 */
export function voucherNoPattern(style: string, prefix: string, iso: string, yearSystem: 'B' | 'C' = 'B'): { base: string; width: number } | null {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const yy = String((yearSystem === 'B' ? y + 543 : y) % 100).padStart(2, '0');
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  switch (style === 'M' ? '3' : style) {
    case '1': return { base: `${prefix}${yy.slice(1)}${mm}${dd}`, width: 2 };
    case '2': return { base: `${prefix}${yy.slice(1)}${mm}`, width: 4 };
    case '3': return { base: `${prefix}${yy}${mm}`, width: 4 };
    case '4': return { base: `${prefix}${yy}${mm}${dd}`, width: 3 };
    default: return null;
  }
}
