import { describe, expect, it } from 'vitest';
import { makeTranslator } from './i18n.js';

describe('สลับ 2 ภาษา — ตัวแปลข้อความ', () => {
  const t = makeTranslator({
    'บันทึก': 'Save', 'สินค้า': 'Item', 'ลูกค้า': 'Customer',
    'บันทึกลูกค้า {0} แล้ว': 'Customer {0} saved',
    'ลบ{0}แล้ว': '{0} deleted',
    'บรรทัดที่ {0}: {1} ขายต่ำกว่าทุน': 'Line {0}: {1} sold below cost',
    '{1} จาก {0} รายการ': '{1} of {0} items',
    '{0} {1}': 'too generic',
    'บริษัท {0}': 'Company {0}', 'ซื้อ': 'Purchase', 'รายละเอียดค่าใช้จ่ายอื่น ๆ': 'Other Expense Details', 'พิมพ์รายงาน': 'Print Report',
    'บันทึกยอดนับ': 'Record Counts', 'menu|ซื้อ': 'Purchasing', 'เลขที่': 'No.',
    '+ เพิ่ม{0} {1}': '+ Add {0} {1}', 'เพิ่มเอกสาร': 'Add Document',
    'ว่าง': '',
  });
  it('exact text keeps surrounding spaces; untranslated or non-Thai text returns null', () => {
    expect(t.tr('บันทึก')).toBe('Save');
    expect(t.tr('  บันทึก ')).toBe('  Save ');
    expect(t.tr('บันทึก\n  ')).toBe('Save\n  ');
    expect(t.tr('ไม่มีในพจนานุกรม')).toBeNull();
    expect(t.tr('Save')).toBeNull();
    expect(t.tr('ว่าง')).toBeNull();                 // ค่าว่างไม่ใช้
  });
  it('patterns fill placeholders, reorder them, and translate Thai values found in the dictionary', () => {
    expect(t.tr('บันทึกลูกค้า C001 แล้ว')).toBe('Customer C001 saved');
    expect(t.tr('ลบสินค้าแล้ว')).toBe('Item deleted');
    expect(t.tr('บรรทัดที่ 3: A-01 ขายต่ำกว่าทุน')).toBe('Line 3: A-01 sold below cost');
    expect(t.tr('25 จาก 100 รายการ')).toBe('25 of 100 items');   // {1}=25 {0}=100
    expect(t.tr('ลูกค้า ทดสอบ')).toBeNull();         // แบบช่องแทนล้วนไม่ใช้
    expect(t.size).toBeGreaterThan(5);
  });
  it('splits breadcrumbs/separators, keeps number or symbol prefixes, translates month abbreviations', () => {
    expect(t.tr('ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ')).toBe('Purchase › Other Expense Details');
    expect(t.tr('🖨 พิมพ์รายงาน')).toBe('🖨 Print Report');
    expect(t.tr('3 บันทึกยอดนับ')).toBe('3 Record Counts');
    expect(t.tr('เลขที่:')).toBe('No.:');
    expect(t.tr('ม.ค. 2569')).toBe('Jan 2569');
    expect(t.tr('IV ซื้อ')).toBe('IV Purchase');                  // รหัสนำหน้าชื่อ
    expect(t.tr('+ เพิ่มเอกสาร')).toBe('+ Add Document');   // ไม่ตัดกลางคำด้วยแบบ '+ เพิ่ม{0} {1}'
    expect(t.tr('ซื้อ › ไม่รู้จัก')).toBeNull();          // แปลไม่ครบทุกส่วน = ไม่แปล
  });
  it('does not translate user data through short patterns; context keys are exact-only', () => {
    expect(t.tr('บริษัท บัดดี้ ดีไซน์ จำกัด')).toBeNull();
    expect(t.tr('บริษัท ABC')).toBe('Company ABC');
    expect(t.exact('menu|ซื้อ')).toBe('Purchasing');
    expect(t.tr('menu|เลขที่ ซื้อ')).toBeNull();
  });
});
