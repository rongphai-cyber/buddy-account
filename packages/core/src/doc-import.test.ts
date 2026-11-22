import { describe, expect, it } from 'vitest';
import { DOC_IMPORT_KINDS, docImportKindOf, docImportPathOf, mapDocImport } from './doc-import.js';

describe('HANDOFF 171: Excel import for other posting documents', () => {
  it('covers receipts/payments, bank, stock and petty-cash payments (not VR, not non-posting documents)', () => {
    expect(DOC_IMPORT_KINDS.map((k) => k.cls)).toEqual(['RE', 'PS', 'BD', 'BW', 'BT', 'BU', 'BV', 'OU', 'RL', 'JU', 'CA', 'DP']);
    expect([docImportPathOf('VR'), docImportPathOf('BS'), docImportPathOf('QT')]).toEqual([null, null, null]);
    const th = (cls: string) => docImportKindOf(docImportPathOf(cls)!)!.columns.map((c) => c.th);
    expect(th('BT')).toEqual(expect.arrayContaining(['บัญชีที่โอนออก', 'บัญชีที่โอนเข้า', 'ค่าธรรมเนียม']));
    expect(th('BD')).not.toContain('บัญชีที่โอนเข้า');
    expect(th('PS')).toEqual(expect.arrayContaining(['อัตราหัก ณ ที่จ่าย', 'แบบ ภ.ง.ด.']));
    expect(th('RE')).not.toContain('อัตราหัก ณ ที่จ่าย');
    expect(th('CA')).toContain('จำนวนเงินที่เพิ่ม/ลด');
    expect(th('CA')).not.toContain('จำนวน');
  });
  it('groups rows by reference, later rows may leave head fields blank, conflicts and bad values name the row and column', () => {
    const K = docImportKindOf('ar-receipts')!;
    const H = ['เลขที่อ้างอิง', 'วันที่', 'รหัสลูกค้า', 'เลขที่บิลที่ตัด', 'ยอดชำระ', 'หมายเหตุ'];
    const r = mapDocImport([H, ['R1', '01/11/2569', 'C001', 'IV1', '', 'ก'], ['R1', '', '', 'IV2', '1,000.50', ''], ['R2', '02/11/2569', 'C002', '', '', ''],
      ['R1', '', '', 'IV3', 'x', ''], ['R1', '', 'C009', 'IV4', '', '']], 'B', K);
    expect(r.docs.map((d) => [d.ref, d.head.date, d.head.party, d.lines.map((l) => `${l.v.bill}:${l.v.amount ?? ''}`).join(' ')])).toEqual([['R1', '2026-11-01', 'C001', 'IV1: IV2:1000.50']]);
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([
      [4, 'ไม่มีเลขที่บิลที่ตัด (คอลัมน์ "เลขที่บิลที่ตัด" ต้องมี)'],
      [5, 'ยอดชำระ "x" ไม่ใช่ตัวเลข'],
      [6, 'เลขที่อ้างอิง R1: คอลัมน์ "รหัสลูกค้า" = "C009" ไม่ตรงกับแถว 2 ("C001") — ช่องหัวเอกสารใส่แถวแรกพอ แถวต่อมาเว้นว่างหรือใส่ค่าเดิม'],
    ]);
    // ธนาคาร: หนึ่งแถว = หนึ่งฉบับ (เลขที่อ้างอิงซ้ำ = ผิด) · ไม่มีคอลัมน์ที่ต้องมี = บอกชื่อคอลัมน์
    const B = docImportKindOf('bank-deposits')!;
    const b = mapDocImport([['เลขที่อ้างอิง', 'วันที่', 'บัญชีเงินฝาก', 'จำนวนเงิน'], ['D1', '01/11/2569', 'B1', '100'], ['D1', '01/11/2569', 'B1', '5']], 'B', B);
    expect([b.docs.length, b.errors[0]!.message]).toEqual([1, 'เลขที่อ้างอิง D1 ซ้ำกับแถว 2 — ฝากเงินสดหนึ่งแถวเป็นหนึ่งเอกสาร']);
    expect(mapDocImport([['เลขที่อ้างอิง', 'วันที่', 'บัญชีเงินฝาก']], 'B', B).errors[0]!.message).toMatch(/ไม่มีคอลัมน์ "จำนวนเงิน"/);
  });
});
