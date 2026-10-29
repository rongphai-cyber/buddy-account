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
  hotkey?: string;
  screens?: string[];
  children?: MenuItem[];
}

const m = (code: string, label: string, phase: MenuItem['phase'], route?: string, screens?: string[]): MenuItem => ({ code, label, phase, route, screens });
const g = (code: string, label: string, phase: MenuItem['phase'], children: MenuItem[], hotkey?: string): MenuItem => ({ code, label, phase, children, hotkey });

export const MENU: MenuItem[] = [
  g('PU', 'ซื้อ', 'P3', [
    m('PU.AE', 'จ่ายเงินมัดจำ', 'P3', undefined, ['ch11:S-PU-02']),
    m('PU.PO', 'ใบสั่งซื้อ', 'P3', undefined, ['ch11:S-PU-01']),
    m('PU.RR', 'ซื้อเงินเชื่อ / ซื้อเงินสด', 'P3', undefined, ['ch11:S-PU-03']),
    m('PU.OE', 'บันทึกค่าใช้จ่ายอื่น ๆ', 'P3', undefined, ['ch11:S-PU-08']),
    m('PU.SUP', 'รายละเอียดผู้จำหน่าย', 'P2', undefined, ['ch07:S-AP-01']),
    m('PU.EXP', 'รายละเอียดค่าใช้จ่ายอื่น ๆ', 'P2', undefined, ['ch07:S-AP-02']),
  ], '1'),
  g('SA', 'ขาย', 'P3', [
    m('SA.QT', 'ใบเสนอราคา', 'P3', undefined, ['ch12:S-QT-01']),
    m('SA.AI', 'รับเงินมัดจำ', 'P3', undefined, ['ch12:S-AI-01']),
    m('SA.SO', 'ใบสั่งขาย', 'P3', undefined, ['ch12:S-SO-01']),
    m('SA.IV', 'ขายเงินเชื่อ / ขายเงินสด', 'P3', undefined, ['ch12:S-IV-01', 'ch12:S-CS-01']),
    m('SA.OI', 'บันทึกรายได้อื่น ๆ', 'P3', undefined, ['ch12:S-OI-01']),
    m('SA.CUS', 'รายละเอียดลูกค้า', 'P2', undefined, ['ch07:S-AR-01']),
    m('SA.INC', 'รายละเอียดรายได้อื่น ๆ', 'P2', undefined, ['ch07:S-SO-02']),
    m('SA.SLM', 'รายละเอียดพนักงานขาย', 'P2', undefined, ['ch07:S-SO-01']),
  ], '2'),
  g('FI', 'การเงิน', 'P3', [
    g('FI.AR', 'ลูกหนี้', 'P3', [
      m('FI.AR.BI', 'ใบวางบิล', 'P3', undefined, ['ch12:S-BI-01']),
      m('FI.AR.BD', 'บันทึกวันนัดรับชำระเงิน', 'P3', undefined, ['ch12:S-BI-02']),
      m('FI.AR.DR', 'ใบเพิ่มหนี้', 'P3', undefined, ['ch12:S-DR-01']),
      m('FI.AR.SR', 'ลดหนี้ / รับคืนสินค้า', 'P3', undefined, ['ch12:S-SR-01']),
      m('FI.AR.RE', 'รับชำระหนี้', 'P3', undefined, ['ch12:S-RE-01']),
      m('FI.AR.OB', 'บันทึกรายการลูกหนี้คงค้าง-ยกมา', 'P3', undefined, ['ch08:S-OB-04']),
    ]),
    g('FI.AP', 'เจ้าหนี้', 'P3', [
      m('FI.AP.BR', 'ใบรับวางบิล', 'P3', undefined, ['ch11:S-PU-06']),
      m('FI.AP.CP', 'ใบเพิ่มหนี้', 'P3', undefined, ['ch11:S-PU-04']),
      m('FI.AP.GR', 'ลดหนี้ / ส่งคืนสินค้า', 'P3', undefined, ['ch11:S-PU-05']),
      m('FI.AP.PS', 'จ่ายชำระหนี้', 'P3', undefined, ['ch11:S-PU-07']),
      m('FI.AP.OB', 'บันทึกรายการเจ้าหนี้คงค้าง-ยกมา', 'P3', undefined, ['ch08:S-OB-03']),
    ]),
    g('FI.BK', 'ธนาคาร', 'P4', [
      m('FI.BK.DQ', 'บันทึกเช็คนำฝาก', 'P4', undefined, ['ch13:S-BK-05', 'ch13:S-BK-07']),
      m('FI.BK.CL', 'บันทึกเช็คผ่าน', 'P4', undefined, ['ch13:S-BK-08']),
      m('FI.BK.CR', 'ทะเบียนเช็ครับ', 'P4', undefined, ['ch13:S-BK-04']),
      m('FI.BK.PC', 'ผ่านเช็คจ่าย', 'P4', undefined, ['ch13:S-BK-09']),
      m('FI.BK.CP', 'ทะเบียนเช็คจ่าย', 'P4', undefined, ['ch13:S-BK-12']),
      m('FI.BK.TX', 'ฝาก / ถอน / โอนเงิน', 'P4', undefined, ['ch13:S-BK-02', 'ch13:S-BK-03']),
      m('FI.BK.ACC', 'รายละเอียดบัญชีเงินฝาก', 'P2', undefined, ['ch07:S-CQ-01', 'ch13:S-BK-01']),
    ]),
    g('FI.VAT', 'ภาษีมูลค่าเพิ่ม', 'P3', [
      m('FI.VAT.IN', 'แฟ้มภาษีซื้อ', 'P3', undefined, ['ch16:S-TX-02']),
      m('FI.VAT.OUT', 'แฟ้มภาษีขาย', 'P3', undefined, ['ch16:S-TX-06']),
    ]),
    m('FI.WHT', 'ภาษีหัก ณ ที่จ่าย', 'P3', undefined, ['ch16:S-TX-10']),
  ], '3'),
  g('IC', 'สินค้า', 'P4', [
    m('IC.TRN', 'รายการประจำวันสินค้า', 'P4', undefined, ['ch14:S-IC-01', 'ch14:S-IC-06', 'ch14:S-IC-08', 'ch14:S-IC-10']),
    m('IC.ITEM', 'รายละเอียดสินค้า', 'P2', undefined, ['ch07:S-IC-01']),
    m('IC.KIT', 'รายละเอียดสินค้าชุด', 'P2', undefined, ['ch07:S-IC-03']),
    m('IC.SRV', 'รายละเอียดสินค้าบริการ', 'P2', undefined, ['ch07:S-IC-05']),
    m('IC.PRICE', 'ตารางราคาขาย', 'P2', undefined, ['ch07:S-IC-06']),
    m('IC.COUNT', 'รายการตรวจนับสินค้า', 'P4', undefined, ['ch14:S-IC-15']),
    m('IC.SERIAL', 'ทะเบียนหมายเลขสินค้า', 'P4', undefined, ['ch14:S-IC-12']),
    m('IC.REORDER', 'กำหนดจุดสั่งซื้อ', 'P2', undefined, ['ch07:S-IC-07']),
  ], '4'),
  g('GL', 'บัญชี', 'P1', [
    m('GL.JNL', 'ลงประจำวัน (สมุดรายวัน)', 'P1', '/gl/journals', ['ch15:S-GL-02']),
    m('GL.ACC', 'ผังบัญชี', 'P1', '/gl/accounts', ['ch07:S-GL-01']),
    m('GL.OB', 'บันทึกยอดยกมา', 'P1', '/gl/opening', ['ch08:S-OB-06']),
    m('GL.LY', 'ยอดปีที่แล้ว', 'P1', undefined, ['ch15:S-GL-16']),
    m('GL.BUD', 'งบประมาณ', 'P1', undefined, ['ch15:S-GL-17']),
    m('GL.INV', 'บัญชีสินค้าคงเหลือ', 'P4', undefined, ['ch15:S-GL-14']),
    m('GL.PC', 'เงินสดย่อย', 'P3', undefined, ['ch15:S-GL-11', 'ch15:S-GL-13']),
    m('GL.TPL', 'ต้นแบบวิธีการบันทึก', 'P1', undefined, ['ch15:S-GL-01']),
    m('GL.BOOK', 'สร้างสมุดรายวัน', 'P1', '/gl/books', ['ch15:S-GL-09']),
    m('GL.FS', 'สร้างงบการเงิน', 'P1', '/fs/layouts', ['ch24:S-FS-01', 'ch24:S-FS-03']),
    m('FA.ASSET', 'รายการทรัพย์สิน', 'P6', undefined, ['ch19:S-FA-01']),
  ], '5'),
  g('RP', 'รายงาน', 'P1', [
    m('RP.TB', 'งบทดลอง', 'P1', '/reports/trial-balance', ['ch08:S-OB-07']),
    m('RP.LEDGER', 'บัญชีแยกประเภท', 'P1', '/reports/ledger'),
    m('RP.JNL', 'รายงานสมุดรายวัน', 'P1', '/reports/journal-book'),
    m('RP.FS', 'งบการเงิน', 'P1', '/fs/statements', ['ch24:S-FS-04']),
    m('RP.DETAIL', 'รายละเอียดประกอบ', 'P1', undefined, ['ch07:R-GL-01']),
    m('RP.PU', 'รายงานระบบซื้อและเจ้าหนี้', 'P5'),
    m('RP.SA', 'รายงานระบบขายและลูกหนี้', 'P5'),
    m('RP.IC', 'รายงานสินค้าคงคลัง', 'P5'),
    m('RP.TAX', 'รายงานภาษี', 'P5'),
    m('RP.CUSTOM', 'สร้างรายงานเอง', 'P5', undefined, ['ch25:S-RD-03']),
  ], '6'),
  g('SET', 'เริ่มระบบ', 'P0', [
    m('SET.CO', 'รายละเอียดกิจการ', 'P0', '/settings/company', ['ch05:S-SET-01']),
    m('SET.DEF', 'ค่าเริ่มต้นแต่ละระบบ', 'P2', undefined, ['ch05:S-SET-02', 'ch05:S-SET-03', 'ch05:S-SET-05', 'ch05:S-SET-07', 'ch05:S-SET-09', 'ch05:S-SET-10']),
    m('SET.PRD', 'รอบบัญชี', 'P1', '/settings/periods', ['ch06:S-SET-01']),
    m('SET.TBL', 'ตารางข้อมูล', 'P2', undefined, ['ch06:S-TBL-01']),
    m('SET.DEPT', 'แผนก', 'P1', '/settings/departments', ['ch06:S-SET-03']),
    m('SET.BRANCH', 'สาขา', 'P0', '/settings/branches'),
    m('SET.DOCNO', 'เลขที่เอกสาร', 'P2', undefined, ['ch09:S-DN-01']),
    m('SET.LINK', 'การเชื่อมต่อบัญชี', 'P2', undefined, ['ch10:S-GL-01', 'ch10:S-GL-02']),
    m('SET.SEC', 'ผู้ใช้งานและสิทธิ์', 'P0', '/settings/users', ['ch23:S-SEC-01', 'ch23:S-SEC-02']),
    m('SET.NEWCO', 'กำหนดบริษัทใหม่', 'P0', '/companies/new', ['ch04:S-CO-03']),
    m('SET.TENANT', 'ลูกค้าผู้ใช้บริการ (ผู้ให้บริการ)', 'P0', '/admin/tenants'),
  ], '7'),
  g('OT', 'อื่น ๆ', 'P1', [
    m('OT.LOCK', 'ปิดงวด / ล็อคงวด', 'P1', '/settings/periods', ['ch18:S-ME-02']),
    m('OT.YE', 'ประมวลผลสิ้นปี', 'P6', undefined, ['ch22:S-YE-02']),
    m('OT.BACKUP', 'สำรองข้อมูล / นำข้อมูลสำรองมาใช้', 'P6', undefined, ['ch20:S-DM-02', 'ch20:S-DM-04']),
    m('OT.CHECK', 'ตรวจสอบข้อมูล', 'P6', undefined, ['ch21:S-CK-04']),
    m('OT.LOG', 'แฟ้มบันทึกเหตุการณ์ทำงาน', 'P6', undefined, ['ch23:S-SEC-04']),
    m('OT.PASS', 'เปลี่ยนรหัสผ่าน', 'P0', '/account/password', ['ch23:S-SEC-05']),
    m('OT.IMPORT', 'นำข้อมูลจาก Express', 'P0', '/admin/import'),
  ], '8'),
];

export function flattenMenu(items: MenuItem[] = MENU, parent?: string): Array<MenuItem & { parent?: string }> {
  const out: Array<MenuItem & { parent?: string }> = [];
  for (const it of items) {
    out.push({ ...it, parent });
    if (it.children) out.push(...flattenMenu(it.children, it.code));
  }
  return out;
}
