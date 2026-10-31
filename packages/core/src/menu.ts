/**
 * เมนูหลักของ Buddy Account — เรียงตามเมนูโปรแกรม Express (คู่มือบทที่ 3 หน้า 27)
 * code ใช้กำหนดสิทธิ์ (sys_menu.code) · route = หน้าจอบนเว็บ (ว่าง = ยังไม่ได้ทำ ดูเฟส)
 * screens = รหัสหน้าจอในคู่มือที่เมนูนี้ครอบคลุม (ดู docs/04_ความครอบคลุมหน้าจอ.md)
 */
export interface MenuItem {
  code: string;
  label: string;
  route?: string;
  phase: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';
  screens?: string[];
  children?: MenuItem[];
}

const m = (code: string, label: string, phase: MenuItem['phase'], route?: string, screens?: string[]): MenuItem => ({ code, label, phase, route, screens });
const g = (code: string, label: string, phase: MenuItem['phase'], children: MenuItem[]): MenuItem => ({ code, label, phase, children });

export const MENU: MenuItem[] = [
  g('PU', 'ซื้อ', 'P3', [
    m('PU.AE', 'จ่ายเงินมัดจำ', 'P3', '/pu/deposits', ['ch11:S-PU-02']),
    m('PU.PO', 'ใบสั่งซื้อ', 'P3', '/pu/orders', ['ch11:S-PU-01']),
    m('PU.RR', 'ซื้อเงินเชื่อ / ซื้อเงินสด', 'P3', '/pu/invoices', ['ch11:S-PU-03', 'ch26:S-AP-03']),
    m('PU.OE', 'บันทึกค่าใช้จ่ายอื่น ๆ', 'P3', '/pu/other-expense', ['ch11:S-PU-08', 'ch26:S-AP-05']),
    m('PU.SUP', 'รายละเอียดผู้จำหน่าย', 'P2', '/ap/suppliers', ['ch07:S-AP-01', 'ch26:S-AP-08']),
    m('PU.EXP', 'รายละเอียดค่าใช้จ่ายอื่น ๆ', 'P2', '/ap/other-expenses', ['ch07:S-AP-02', 'ch26:S-AP-02']),
  ]),
  g('SA', 'ขาย', 'P3', [
    m('SA.QT', 'ใบเสนอราคา', 'P3', '/sa/quotations', ['ch12:S-QT-01']),
    m('SA.AI', 'รับเงินมัดจำ', 'P3', '/sa/deposits', ['ch12:S-AI-01']),
    m('SA.SO', 'ใบสั่งขาย', 'P3', '/sa/orders', ['ch12:S-SO-01']),
    m('SA.IV', 'ขายเงินเชื่อ / ขายเงินสด', 'P3', '/sa/invoices', ['ch12:S-IV-01', 'ch12:S-CS-01']),
    m('SA.OI', 'บันทึกรายได้อื่น ๆ', 'P3', '/sa/other-income', ['ch12:S-OI-01']),
    m('SA.CUS', 'รายละเอียดลูกค้า', 'P2', '/ar/customers', ['ch07:S-AR-01']),
    m('SA.INC', 'รายละเอียดรายได้อื่น ๆ', 'P2', '/ar/other-incomes', ['ch07:S-SO-02']),
    m('SA.SLM', 'รายละเอียดพนักงานขาย', 'P2', '/ar/salespersons', ['ch07:S-SO-01']),
  ]),
  g('FI', 'การเงิน', 'P3', [
    g('FI.AR', 'ลูกหนี้', 'P3', [
      m('FI.AR.BI', 'ใบวางบิล', 'P3', '/fi/ar/bills', ['ch12:S-BI-01']),
      m('FI.AR.BD', 'บันทึกวันนัดรับชำระเงิน', 'P3', '/fi/ar/bill-appointments', ['ch12:S-BI-02']),
      m('FI.AR.DR', 'ใบเพิ่มหนี้', 'P3', '/fi/ar/debit-notes', ['ch12:S-DR-01']),
      m('FI.AR.SR', 'ลดหนี้ / รับคืนสินค้า', 'P3', '/fi/ar/credit-notes', ['ch12:S-SR-01']),
      m('FI.AR.RE', 'รับชำระหนี้', 'P3', '/fi/ar/receipts', ['ch12:S-RE-01', 'ch12:S-PM-01']),
      m('FI.AR.OB', 'บันทึกรายการลูกหนี้คงค้าง-ยกมา', 'P3', '/fi/ar/opening', ['ch08:S-OB-04']),
    ]),
    g('FI.AP', 'เจ้าหนี้', 'P3', [
      m('FI.AP.BR', 'ใบรับวางบิล', 'P3', '/fi/ap/bills', ['ch11:S-PU-06']),
      m('FI.AP.CP', 'ใบเพิ่มหนี้', 'P3', '/fi/ap/debit-notes', ['ch11:S-PU-04']),
      m('FI.AP.GR', 'ลดหนี้ / ส่งคืนสินค้า', 'P3', '/fi/ap/credit-notes', ['ch11:S-PU-05']),
      m('FI.AP.PS', 'จ่ายชำระหนี้', 'P3', '/fi/ap/payments', ['ch11:S-PU-07', 'ch26:S-AP-13', 'ch11:S-PU-C4', 'ch11:S-PU-C5', 'ch11:S-PU-C6']),
      m('FI.AP.OB', 'บันทึกรายการเจ้าหนี้คงค้าง-ยกมา', 'P3', '/fi/ap/opening', ['ch08:S-OB-03']),
    ]),
    // เงินสดย่อย (ข้อกำหนดเจ้าของ 31/10/2569: ย้ายจากเมนูบัญชีมาการเงิน) — สิทธิ์กำหนดที่ GL.PC ใช้กับทั้ง DP และ VR
    g('GL.PC', 'เงินสดย่อย', 'P3', [
      m('GL.PC.DP', 'จ่ายค่าใช้จ่ายจากเงินสดย่อย (DP)', 'P3', '/fi/petty-cash', ['ch15:S-GL-11', 'ch15:S-GL-12']),
      m('GL.PC.VR', 'เบิกชดเชยเงินสดย่อย (VR)', 'P3', '/fi/petty-cash/vr', ['ch15:S-GL-13']),
    ]),
  ]),
  g('FI.BK', 'ธนาคาร', 'P4', [
    m('FI.BK.DQ', 'บันทึกเช็คนำฝาก', 'P4', '/fi/cheques/slips', ['ch13:S-BK-05', 'ch13:S-BK-07']),
    m('FI.BK.CL', 'บันทึกเช็คผ่าน', 'P4', '/fi/cheques/pass', ['ch13:S-BK-08']),
    m('FI.BK.CR', 'ทะเบียนเช็ครับ', 'P4', '/fi/cheques/received', ['ch13:S-BK-04']),
    m('FI.BK.PC', 'ผ่านเช็คจ่าย', 'P4', '/fi/cheques/pass-paid', ['ch13:S-BK-09']),
    m('FI.BK.CP', 'ทะเบียนเช็คจ่าย', 'P4', '/fi/cheques/paid', ['ch13:S-BK-12']),
    m('FI.BK.TX', 'ฝาก / ถอน / โอนเงิน', 'P4', '/fi/bank/deposits', ['ch13:S-BK-02', 'ch13:S-BK-03']),
    m('FI.BK.BOOK', 'สมุดเงินฝาก', 'P4', '/fi/bank/book'),
    m('FI.BK.REC', 'กระทบยอดเงินฝากธนาคาร', 'P4', '/fi/bank/reconcile'),
    m('FI.BK.ACC', 'รายละเอียดบัญชีเงินฝาก', 'P2', '/fi/bank-accounts', ['ch07:S-CQ-01', 'ch13:S-BK-01']),
  ]),
  g('TX', 'ภาษี', 'P3', [
    g('FI.VAT', 'ภาษีมูลค่าเพิ่ม', 'P3', [
      m('FI.VAT.IN', 'แฟ้มภาษีซื้อ', 'P3', '/tax/vat/P', ['ch16:S-TX-01', 'ch16:S-TX-02', 'ch16:S-TX-03', 'ch16:S-TX-04', 'ch16:S-TX-05']),
      m('FI.VAT.OUT', 'แฟ้มภาษีขาย', 'P3', '/tax/vat/S', ['ch16:S-TX-06', 'ch16:S-TX-07', 'ch16:S-TX-08']),
      m('FI.VAT.ETAX', 'ส่งออก e-Tax Invoice (XML)', 'P7', '/tax/etax'),
    ]),
    g('TX.WHT', 'ภาษีหัก ณ ที่จ่าย', 'P3', [
      m('FI.WHT', 'แฟ้มภาษีหัก ณ ที่จ่าย', 'P3', '/tax/wht', ['ch16:S-TX-09', 'ch16:S-TX-10']),
      m('FI.WHT.CERT', 'พิมพ์หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', 'P3', '/tax/wht50'),
    ]),
  ]),
  g('IC', 'สินค้า', 'P4', [
    m('IC.STOCK', 'ยอดคงเหลือ / สต๊อกการ์ด', 'P4', '/ic/stock'),
    m('IC.TRN', 'รายการประจำวันสินค้า', 'P4', '/ic/issues', ['ch14:S-IC-01', 'ch14:S-IC-06', 'ch14:S-IC-08', 'ch14:S-IC-10', 'ch26:S-AP-04', 'ch26:S-AP-06', 'ch26:S-AP-11']),
    m('IC.ITEM', 'รายละเอียดสินค้า', 'P2', '/ic/items', ['ch07:S-IC-01', 'ch26:S-AP-01']),
    m('IC.KIT', 'รายละเอียดสินค้าชุด', 'P2', '/ic/kits', ['ch07:S-IC-03']),
    m('IC.SRV', 'รายละเอียดสินค้าบริการ', 'P2', '/ic/services', ['ch07:S-IC-05', 'ch26:S-AP-09']),
    m('IC.PRICE', 'ตารางราคาขาย', 'P2', '/ic/prices', ['ch07:S-IC-06']),
    m('IC.OB', 'ยอดยกมาสินค้า', 'P4', '/ic/opening', ['ch08:S-OB-01', 'ch08:S-OB-02']),
    m('IC.COUNT', 'รายการตรวจนับสินค้า', 'P4', '/ic/counts', ['ch14:S-IC-15', 'ch14:S-IC-17', 'ch14:S-IC-20']),
    m('IC.SERIAL', 'ทะเบียนหมายเลขสินค้า', 'P4', '/ic/serials', ['ch14:S-IC-12']),
    m('IC.REORDER', 'กำหนดจุดสั่งซื้อ', 'P2', '/ic/reorder', ['ch07:S-IC-07']),
  ]),
  g('GL', 'บัญชี', 'P1', [
    m('GL.JNL', 'ลงประจำวัน (สมุดรายวัน)', 'P1', '/gl/journals', ['ch15:S-GL-02', 'ch15:S-GL-05', 'ch15:S-GL-06', 'ch26:S-AP-12']),
    m('GL.ACC', 'ผังบัญชี', 'P1', '/gl/accounts', ['ch07:S-GL-01', 'ch26:S-AP-07']),
    m('GL.OB', 'บันทึกยอดยกมา', 'P1', '/gl/opening', ['ch08:S-OB-06']),
    m('GL.LY', 'ยอดปีที่แล้ว', 'P1', '/gl/prior-year', ['ch15:S-GL-16']),
    m('GL.BUD', 'งบประมาณ', 'P1', '/gl/budget', ['ch15:S-GL-17']),
    m('GL.INV', 'บัญชีสินค้าคงเหลือ', 'P4', '/gl/inventory', ['ch15:S-GL-14', 'ch15:S-GL-15']),
    m('GL.TPL', 'ต้นแบบวิธีการบันทึก', 'P1', '/gl/templates', ['ch15:S-GL-01']),
    m('GL.BOOK', 'สร้างสมุดรายวัน', 'P1', '/gl/books', ['ch15:S-GL-09']),
    m('GL.FS', 'สร้างงบการเงิน', 'P1', '/fs/layouts', ['ch24:S-FS-01', 'ch24:S-FS-03']),
    m('FA.ASSET', 'รายการทรัพย์สิน', 'P6', '/fa/assets', ['ch19:S-FA-01', 'ch19:S-FA-02', 'ch19:S-FA-03']),
    m('FA.DEPR', 'คิดค่าเสื่อม-ลงบัญชี', 'P6', '/fa/depreciation', ['ch19:S-FA-04']),
  ]),
  g('RP', 'รายงาน', 'P1', [
    m('RP.DASH', 'แดชบอร์ดผู้บริหาร', 'P7', '/reports/dashboard'),
    m('RP.TB', 'งบทดลอง', 'P1', '/reports/trial-balance', ['ch08:S-OB-07']),
    m('RP.LEDGER', 'บัญชีแยกประเภท', 'P1', '/reports/ledger'),
    m('RP.JNL', 'รายงานสมุดรายวัน', 'P1', '/reports/journal-book'),
    m('RP.FS', 'งบการเงิน', 'P1', '/fs/statements', ['ch24:S-FS-04']),
    m('RP.DETAIL', 'รายละเอียดประกอบ', 'P1', '/reports/account-detail', ['ch07:R-GL-01']),
    m('RP.CENTER', 'ศูนย์รายงาน (พิมพ์รายงาน)', 'P5', '/reports/center', ['ch17:S-RP-01', 'ch17:S-RP-02', 'ch17:S-RP-03', 'ch17:S-RP-04']),
    m('RP.PU', 'รายงานระบบซื้อและเจ้าหนี้', 'P5', '/reports/center?g=2'),
    m('RP.SA', 'รายงานระบบขายและลูกหนี้', 'P5', '/reports/center?g=1'),
    m('RP.IC', 'รายงานสินค้าคงคลัง', 'P5', '/reports/center?g=4'),
    m('RP.CHQ', 'รายงานเกี่ยวกับเช็ค', 'P5', '/reports/center?g=3'),
    m('RP.GL', 'รายงานบัญชี (อื่น ๆ)', 'P5', '/reports/center?g=5'),
    m('RP.TAX', 'รายงานภาษี', 'P5', '/reports/center?g=6'),
    m('RP.CUSTOM', 'สร้างรายงานเอง', 'P5', '/reports/center?g=U', ['ch25:S-RD-03', 'ch25:S-RD-04']),
    m('RP.FORM', 'แบบฟอร์มพิมพ์เอกสาร', 'P5', '/settings/print-forms', ['ch25:S-RD-01', 'ch25:S-RD-02', 'ch03:S-UI-08', 'ch03:S-UI-10']),
  ]),
  g('SET', 'เริ่มระบบ', 'P0', [
    m('SET.CO', 'รายละเอียดกิจการ', 'P0', '/settings/company', ['ch05:S-SET-01']),
    m('SET.DEF', 'ค่าเริ่มต้นแต่ละระบบ', 'P2', '/settings/defaults', ['ch05:S-SET-02', 'ch05:S-SET-03', 'ch05:S-SET-05', 'ch05:S-SET-07', 'ch05:S-SET-09', 'ch05:S-SET-10', 'ch05:S-SET-11']),
    m('SET.IAG', 'กลุ่มบัญชีสินค้า', 'P2', '/settings/item-account-groups', ['ch05:S-SET-04']),
    m('SET.FAG', 'กลุ่มบัญชีทรัพย์สิน', 'P6', '/settings/asset-account-groups', ['ch05:S-SET-12']),
    m('SET.PAYM', 'วิธีรับ/จ่ายชำระหนี้', 'P2', '/settings/payment-methods', ['ch05:S-SET-06', 'ch05:S-SET-08']),
    m('SET.PRD', 'รอบบัญชี', 'P1', '/settings/periods', ['ch06:S-SET-01']),
    m('SET.TBL', 'ตารางข้อมูล', 'P2', '/settings/data-tables', ['ch06:S-TBL-01']),
    m('SET.DEPT', 'แผนก', 'P1', '/settings/departments', ['ch06:S-SET-03']),
    m('SET.BRANCH', 'สาขา', 'P0', '/settings/branches'),
    m('SET.DOCNO', 'เลขที่เอกสาร', 'P2', '/settings/doc-types', ['ch09:S-DN-01', 'ch26:S-AP-10']),
    m('SET.LINK', 'การเชื่อมต่อบัญชี', 'P2', '/settings/gl-link', ['ch10:S-GL-01', 'ch10:S-GL-02']),
    m('SET.SEC', 'ผู้ใช้งานและสิทธิ์', 'P0', '/settings/users', ['ch23:S-SEC-01', 'ch23:S-SEC-02', 'ch23:S-SEC-03']),
    m('SET.API', 'กุญแจ API (เชื่อมต่อระบบอื่น)', 'P7', '/settings/api-keys'),
    m('SET.AI', 'AI อ่านบิล (Claude)', 'P7', '/settings/ai'),
    m('SET.PDPA', 'ข้อมูลส่วนบุคคล (PDPA)', 'P0', '/settings/pdpa'),
    m('SET.DEVICE', 'เครื่องสาขา (ออฟไลน์)', 'P7', '/settings/devices'),
    m('SET.NEWCO', 'กำหนดบริษัทใหม่', 'P0', '/companies/new', ['ch04:S-CO-03']),
    m('SET.TENANT', 'ลูกค้าผู้ใช้บริการ (ผู้ให้บริการ)', 'P0', '/admin/tenants'),
  ]),
  g('OT', 'อื่น ๆ', 'P1', [
    m('OT.LOCK', 'ปิดงวด / ล็อคงวด', 'P1', '/settings/periods', ['ch18:S-ME-02']),
    m('OT.YE', 'ประมวลผลสิ้นปี', 'P6', '/gl/year-end', ['ch22:S-YE-01', 'ch22:S-YE-02', 'ch22:S-YE-03']),
    m('OT.BACKUP', 'สำรองข้อมูล / นำข้อมูลสำรองมาใช้', 'P6', '/tools/backup', ['ch20:S-DM-02', 'ch20:S-DM-03', 'ch20:S-DM-04', 'ch23:S-SEC-07', 'ch23:S-SEC-08']),
    m('OT.CHECK', 'ตรวจสอบข้อมูล', 'P6', '/reports/center?g=5,5.A', ['ch21:S-CK-04']),
    m('OT.LOG', 'แฟ้มบันทึกเหตุการณ์ทำงาน', 'P6', '/tools/activity-log', ['ch23:S-SEC-04', 'ch23:S-SEC-04a']),
    m('OT.PASS', 'รหัสผ่านและยืนยันตัวตน', 'P0', '/account/password', ['ch23:S-SEC-05']),
    m('OT.IMPORT', 'นำข้อมูลจาก Express', 'P0', '/admin/import'),
    m('OT.IMPTRADE', 'นำเข้ารายการขาย/ซื้อจาก Excel', 'P7', '/tools/trade-import'),
  ]),
];

export function flattenMenu(items: MenuItem[] = MENU, parent?: string): Array<MenuItem & { parent?: string }> {
  const out: Array<MenuItem & { parent?: string }> = [];
  for (const it of items) {
    out.push({ ...it, parent });
    if (it.children) out.push(...flattenMenu(it.children, it.code));
  }
  return out;
}

/**
 * ตารางข้อมูล (เริ่มระบบ › 2 ตารางข้อมูล — คู่มือบทที่ 6 S-TBL-00/01)
 * table: เก็บในตารางของตัวเอง (อ้างด้วย id) หรือ md_lookup (อ้างด้วยรหัส) · refs = ช่องที่อ้างรหัสนี้ (ใช้แล้วห้ามลบ/แก้รหัส)
 */
export const DATA_TABLES: Array<{ code: string; label: string; table: 'md_bank' | 'md_unit' | 'md_warehouse' | 'md_lookup'; rate?: boolean; refs?: Array<[string, string]>; hint?: string }> = [
  { code: '01', label: 'ชื่อธนาคาร', table: 'md_bank', refs: [['md_supplier_bank', 'bank_code']] },
  { code: '02', label: 'สถานะเช็ค', table: 'md_lookup' },
  { code: '20', label: 'หน่วยนับ', table: 'md_unit', rate: true, hint: 'อัตรา = ตัวคูณให้เป็นหน่วยย่อย เช่น โหล 12.0 — ใช้กับสินค้าที่หน่วยเป็นโหล โปรแกรมคูณ 12 ก่อนเก็บเป็นหน่วยย่อย' },
  { code: '21', label: 'คลังสินค้า', table: 'md_warehouse' },
  { code: '22', label: 'หมวดสินค้า', table: 'md_lookup', refs: [['md_item', 'category_code']] },
  { code: '23', label: 'ระดับสินค้า', table: 'md_lookup', refs: [['md_item', 'item_level']], hint: 'สินค้าชุดที่ประกอบจากสินค้าทั่วไป = ระดับ 1 · ชุดซ้อนชุดต้องใช้ระดับต่างกัน' },
  { code: '40', label: 'เขตการขาย', table: 'md_lookup', refs: [['md_customer', 'sales_area_code'], ['md_salesperson', 'sales_area_code']] },
  { code: '41', label: 'ขนส่งโดย', table: 'md_lookup', refs: [['md_customer', 'ship_via_code'], ['md_supplier', 'ship_via_code']] },
  { code: '42', label: 'เหตุผลการยกเลิกยอดสั่งขาย', table: 'md_lookup' },
  { code: '43', label: 'เหตุผลการยกเลิกยอดสั่งซื้อ', table: 'md_lookup' },
  { code: '44', label: 'สถานะใบเสนอราคา', table: 'md_lookup', refs: [['doc_header', 'status_code']] },
  { code: '45', label: 'ประเภทลูกค้า', table: 'md_lookup', refs: [['md_customer', 'customer_type']] },
  { code: '46', label: 'ประเภทผู้จำหน่าย', table: 'md_lookup', refs: [['md_supplier', 'supplier_type']] },
  { code: '47', label: 'ประเภทพนักงานขาย', table: 'md_lookup', refs: [['md_salesperson', 'salesperson_type']] },
  { code: '51', label: 'ข้อความสำเร็จรูป (หมายเหตุ)', table: 'md_lookup', hint: '[สันนิษฐาน] ข้อมูลจาก Express เป็นข้อความอธิบาย เช่น วิธีติดสติ๊กเกอร์ — ใช้เลือกในบรรทัดหมายเหตุของเอกสาร' },
  { code: '52', label: 'ประเภททรัพย์สิน', table: 'md_lookup', hint: 'แบ่งตามชนิด (รถ คอมพิวเตอร์ เฟอร์นิเจอร์) หรือตามสถานที่ก็ได้' },
  { code: '53', label: 'สถานะใบเบิกเงินสดย่อย', table: 'md_lookup', refs: [['doc_header', 'status_code']] },
  { code: '55', label: 'หมวดภาษีหัก ณ ที่จ่าย', table: 'md_lookup', refs: [['md_supplier', 'wht_form'], ['md_customer', 'wht_category']], hint: 'S03 ภ.ง.ด.3 (บุคคลธรรมดา) · S53 ภ.ง.ด.53 (นิติบุคคล) · Z03/Z53 ถูกหัก (ไม่ยื่น)' },
  { code: '60', label: 'เฟส / Collection', table: 'md_lookup' },
  { code: '61', label: 'รหัสต้นทุน', table: 'md_lookup' },
];

/**
 * ระบบที่ปิดได้ทั้งบริษัท (ข้อกำหนดเจ้าของ 30/10/2569: "ปิดบางระบบไม่ให้เห็น/ใช้")
 * ปิดแล้ว = ทุกคนในบริษัท (รวมผู้ดูแล) ไม่เห็นเมนู และ API ของเมนูเหล่านั้นปฏิเสธ — ข้อมูลเดิมไม่ถูกลบ เปิดกลับได้
 * menus = รหัสเมนูหรือกลุ่ม (กลุ่ม = ทุกเมนูข้างใต้) · บัญชี เริ่มระบบ และรายการสินค้า/บริการ ปิดไม่ได้ (ระบบอื่นต้องใช้)
 */
export interface ModuleSwitch { key: string; label: string; menus: string[]; hint: string }
export const MODULE_SWITCHES: ModuleSwitch[] = [
  { key: 'PU', label: 'ระบบซื้อและเจ้าหนี้', menus: ['PU', 'FI.AP', 'RP.PU'], hint: 'ซื้อ ใบสั่งซื้อ จ่ายมัดจำ ค่าใช้จ่ายอื่น เจ้าหนี้ จ่ายชำระ รายงานซื้อ' },
  { key: 'SA', label: 'ระบบขายและลูกหนี้', menus: ['SA', 'FI.AR', 'RP.SA'], hint: 'ขาย ใบเสนอราคา ใบสั่งขาย รับมัดจำ รายได้อื่น ลูกหนี้ รับชำระ รายงานขาย' },
  { key: 'ORDER', label: 'ใบเสนอราคา / ใบสั่งขาย / ใบสั่งซื้อ', menus: ['SA.QT', 'SA.SO', 'PU.PO'], hint: 'กิจการที่เปิดบิลทันทีโดยไม่มีใบสั่ง' },
  { key: 'DEPOSIT', label: 'เงินมัดจำ (รับ/จ่าย)', menus: ['SA.AI', 'PU.AE'], hint: 'รับเงินมัดจำ จ่ายเงินมัดจำ' },
  { key: 'BILLING', label: 'ใบวางบิล / ใบรับวางบิล', menus: ['FI.AR.BI', 'FI.AR.BD', 'FI.AP.BR'], hint: 'วางบิล นัดรับชำระ รับวางบิล' },
  { key: 'BANK', label: 'ระบบธนาคารและเช็ค', menus: ['FI.BK', 'RP.CHQ'], hint: 'เช็ครับ/จ่าย นำฝาก ผ่านเช็ค ฝาก/ถอน/โอน สมุดเงินฝาก กระทบยอด' },
  { key: 'STOCK', label: 'ระบบสินค้าคงคลัง (สต๊อก)', menus: ['IC.STOCK', 'IC.TRN', 'IC.OB', 'IC.COUNT', 'IC.SERIAL', 'IC.REORDER', 'GL.INV', 'RP.IC'], hint: 'ยอดคงเหลือ รายการประจำวันสินค้า ตรวจนับ ยอดยกมา — รายละเอียดสินค้า/บริการยังใช้ได้' },
  { key: 'FA', label: 'ทรัพย์สินถาวร', menus: ['FA.ASSET', 'FA.DEPR'], hint: 'ทะเบียนทรัพย์สิน คิดค่าเสื่อม' },
  { key: 'PETTY', label: 'เงินสดย่อย', menus: ['GL.PC'], hint: '' },
  { key: 'BUDGET', label: 'งบประมาณ', menus: ['GL.BUD'], hint: '' },
  { key: 'ETAX', label: 'ส่งออก e-Tax Invoice', menus: ['FI.VAT.ETAX'], hint: '' },
];
const MENU_PARENT = new Map(flattenMenu().map((m) => [m.code, m.parent ?? null]));
/** รหัสระบบที่ปิด → ชุดรหัสเมนู/กลุ่มที่ปิด (รหัสที่ไม่รู้จักข้าม) */
export function offMenus(keys: unknown): Set<string> {
  const ks = Array.isArray(keys) ? keys.map(String) : [];
  return new Set(MODULE_SWITCHES.filter((m) => ks.includes(m.key)).flatMap((m) => m.menus));
}
/** เมนูนี้อยู่ในระบบที่ปิดหรือไม่ (ตัวเองหรือกลุ่มแม่) — คืนชื่อระบบที่ปิด */
export function menuOffBy(menu: string, keys: unknown): ModuleSwitch | null {
  const ks = Array.isArray(keys) ? keys.map(String) : [];
  const chain: string[] = [];
  for (let c: string | null | undefined = menu; c; c = MENU_PARENT.get(c)) chain.push(c);
  return MODULE_SWITCHES.find((m) => ks.includes(m.key) && m.menus.some((x) => chain.includes(x))) ?? null;
}
