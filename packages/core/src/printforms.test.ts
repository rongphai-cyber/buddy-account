import { describe, expect, it } from 'vitest';
import { checkApprove, checkPrint, checkUnapprove, copyMark, defaultLayout, sheetCopies, docMenuOf, docPath, normalizeLayout, printFamily, printMenu, printPartyLabel, printTitle } from './printforms.js';

describe('แบบฟอร์มพิมพ์เอกสาร (S-RD-01/02)', () => {
  it('จัดกลุ่มเอกสารและเมนูสิทธิ์', () => {
    expect([printFamily('IV'), printFamily('RE'), printFamily('BS'), printFamily('OE'), printFamily('OU'), printFamily('BD'), printFamily('DP'), printFamily('GL')])
      .toEqual(['trade', 'settle', 'bill', 'cash', 'stock', 'bank', 'petty', 'journal']);
    expect([docMenuOf('IV'), docMenuOf('PS'), docMenuOf('RL'), docMenuOf('BT'), docMenuOf('VR'), docMenuOf('IV', true), docMenuOf('GL'), docMenuOf('AI', true)]).toEqual(['SA.IV', 'FI.AP.PS', 'IC.TRN', 'FI.BK.TX', 'GL.PC', 'FI.AR.OB', 'GL.JNL', 'FI.AR.DOB']);
    expect([docPath('IV', 'x'), docPath('IV', 'x', true), docPath('RR', 'x', true), docPath('PS', 'x'), docPath('BT', 'x'), docPath('RL', 'x'), docPath('DP', 'x'), docPath('VR', 'x'), docPath('BQ', 'x'), docPath('OS', 'x', true), docPath('GL', 'x'), docPath('ZZ', 'x'), docPath(null, 'x'), docPath('AI', 'x', true)])
      .toEqual(['/sa/invoices/x', '/fi/ar/opening/x', '/fi/ap/opening/x', '/fi/ap/payments/x', '/fi/bank/transfers/x', '/ic/transfers/x', '/fi/petty-cash/dp/x', '/fi/petty-cash/vr/x', '/fi/cheques/slips/x', '/ic/opening/x', '/gl/journals/x', null, null, '/fi/ar/deposit-opening/x']);
  });
  it('ต้นฉบับ/สำเนา: พิมพ์ซ้ำ "ต้นฉบับ" เป็น "สำเนา" · ไม่มีคำกำกับ = สำเนา · ปิดได้ต่อแบบฟอร์ม', () => {
    const iv = defaultLayout('IV', 'pro');
    expect(iv.reprint_copy).toBe(true);
    expect(sheetCopies(iv, 0)).toEqual(['ต้นฉบับ', 'สำเนา']);
    expect(sheetCopies(iv, 1)).toEqual(['สำเนา', 'สำเนา']);
    expect(sheetCopies({ copies: ['ต้นฉบับ (ลูกค้า)', 'สำเนา (บัญชี)', 'ใบส่งของ'], reprint_copy: true }, 3)).toEqual(['สำเนา (ลูกค้า)', 'สำเนา (บัญชี)', 'ใบส่งของ']);
    expect(sheetCopies(defaultLayout('RE', 'pro'), 0)).toEqual(['']);
    expect(sheetCopies(defaultLayout('RE', 'pro'), 2)).toEqual(['สำเนา']);
    expect(sheetCopies({ copies: ['ต้นฉบับ', 'สำเนา'], reprint_copy: false }, 5)).toEqual(['ต้นฉบับ', 'สำเนา']);
    expect(sheetCopies({ copies: [], reprint_copy: false }, 5)).toEqual(['']);
    // ฟอร์มเก่าที่บันทึกก่อนมีตัวเลือก = เปิด · ค่าที่ไม่ใช่ true/false = ค่าเริ่มต้น
    expect(normalizeLayout('IV', 'grid', { copies: ['ต้นฉบับ'] }).reprint_copy).toBe(true);
    expect(normalizeLayout('IV', 'grid', { reprint_copy: false }).reprint_copy).toBe(false);
    expect(normalizeLayout('IV', 'grid', { reprint_copy: 'no' }).reprint_copy).toBe(true);
    expect([copyMark(0), copyMark(1), copyMark(7)]).toEqual(['ต้นฉบับ', 'สำเนา', 'สำเนา']);
  });
  it('ต้นแบบ 1–4 + ฟอร์มของบริษัททับหมายเลขเดิม / ปิดหมายเลขได้', () => {
    const m = printMenu('IV', [{ slot: 1, name: 'ใบกำกับภาษี บริษัท', base: 'plain', layout: { title: 'ใบกำกับภาษี', copies: ['ต้นฉบับ'] } }, { slot: 4, name: 'x', base: 'grid', layout: {}, status: 'I' }, { slot: 7, name: 'ใบส่งของ', base: 'half', layout: {} }], 'ขายเงินเชื่อ');
    expect(m.map((x) => `${x.slot}${x.custom ? '*' : ''}:${x.base}`)).toEqual(['1*:plain', '2:plain', '3:half', '6:grid', '7*:half']);
    expect(m[0]!.layout.title).toBe('ใบกำกับภาษี');
    expect(m[4]!.layout.title).toBe('ขายเงินเชื่อ');
  });
  it('ทำความสะอาดแบบฟอร์ม: คอลัมน์ที่ไม่รู้จักถูกตัด คอลัมน์ใหม่ต่อท้ายแบบซ่อน ค่าที่เกินช่วงใช้ค่าเริ่มต้น', () => {
    const l = normalizeLayout('IV', 'grid', { columns: [{ key: 'amount', label: 'Amount', width: 500 }, { key: 'hack', label: 'x' }, { key: 'name', show: false }], font_pt: 99, min_rows: -5, head_fields: ['due_date', 'bogus'], signatures: ['ก', '', 'ข'] });
    expect(l.columns.slice(0, 2).map((c) => `${c.key}:${c.label}:${c.width}:${c.show}`)).toEqual(['amount:Amount:80:true', 'name:รายละเอียด:34:false']);
    expect(l.columns.find((c) => c.key === 'qty')?.show).toBe(false);
    expect([l.font_pt, l.min_rows, l.head_fields, l.signatures]).toEqual([10, 0, ['due_date'], ['ก', 'ข']]);
    expect(defaultLayout('HS', 'half').columns.find((c) => c.key === 'disc')?.show).toBe(false);
    // ใบเสร็จ (ข้อกำหนดเจ้าของ 31/10/2569): เลือกแสดงเลขที่บิล/รายการสินค้า · ต้นแบบที่ 5 = รายการสินค้าของบิล
    expect(normalizeLayout('RE', 'grid', { settle_detail: 'items' }).settle_detail).toBe('items');
    expect(normalizeLayout('RE', 'grid', { settle_detail: 'bogus' }).settle_detail).toBe('auto');
    expect(printMenu('RE', []).map((f) => `${f.slot}:${f.layout.settle_detail}`)).toEqual(['1:auto', '2:auto', '3:auto', '4:auto', '5:items', '6:auto']);
    expect(printMenu('IV', []).length).toBe(5);
  });
  it('แบบฟอร์มมืออาชีพ (เจ้าของ 04/11/2569): ฟอร์ม 1 · ชื่อเอกสารมาตรฐาน · หัวกล่องคู่ค้า', () => {
    const m = printMenu('IV', []);
    expect(m.map((f) => `${f.slot}:${f.base}`)).toEqual(['1:pro', '2:plain', '3:half', '4:cont', '6:grid']);
    expect(printMenu('RE', []).find((f) => f.slot === 5)?.base).toBe('pro');
    // ฟอร์มเก่าที่บันทึกด้วยต้นแบบที่ไม่รู้จัก → มืออาชีพ
    expect(printMenu('IV', [{ slot: 8, name: 'x', base: 'bogus', layout: {} }]).find((f) => f.slot === 8)?.base).toBe('pro');
    const pro = defaultLayout('IV', 'pro');
    expect([pro.min_rows, pro.logo, pro.columns.find((c) => c.key === 'code')?.width, pro.columns.find((c) => c.key === 'unit')?.width]).toEqual([0, 'left', 17, 10]);
    expect(defaultLayout('IV', 'grid').columns.find((c) => c.key === 'code')?.width).toBe(14);
    expect(defaultLayout('HS', 'pro').head_fields).not.toContain('due_date');
    expect(defaultLayout('IV', 'pro').head_fields).toContain('due_date');
    // ชื่อทั่วไปของประเภทเอกสาร → ชื่อเอกสารมาตรฐาน (มี VAT = มีคำว่า ใบกำกับภาษี)
    expect(printTitle('IV', 'ขายเงินเชื่อ', 'Credit Sales', true)).toEqual({ th: 'ใบแจ้งหนี้/ใบกำกับภาษี', en: 'INVOICE / TAX INVOICE' });
    expect(printTitle('IV', 'ขายเงินเชื่อ', '', false)).toEqual({ th: 'ใบแจ้งหนี้', en: 'INVOICE' });
    expect(printTitle('HS', 'ขายเงินสด', '', true).th).toBe('ใบเสร็จรับเงิน/ใบกำกับภาษี');
    expect(printTitle('CN', 'ใบลดหนี้/รับคืน', '', true)).toEqual({ th: 'ใบลดหนี้', en: 'CREDIT NOTE' });
    expect(printTitle('RL', 'โอนย้ายระหว่างคลัง', 'Stock Transfer', false)).toEqual({ th: 'ใบโอนย้ายสินค้า', en: 'STOCK TRANSFER' });
    expect(printTitle('IV', '', '', true).th).toBe('ใบแจ้งหนี้/ใบกำกับภาษี');
    // บริษัทตั้งชื่อเอง → คงชื่อนั้น (อังกฤษว่าง = ใช้ชื่ออังกฤษมาตรฐาน)
    expect(printTitle('IV', 'ใบกำกับภาษี/ใบส่งของ', '', true)).toEqual({ th: 'ใบกำกับภาษี/ใบส่งของ', en: 'INVOICE / TAX INVOICE' });
    expect(printTitle('IV', 'ใบส่งของ', 'Delivery Order', true)).toEqual({ th: 'ใบส่งของ', en: 'Delivery Order' });
    expect(printTitle('BT', 'โอนเงินระหว่างธนาคาร', 'Bank Transfer', false)).toEqual({ th: 'โอนเงินระหว่างธนาคาร', en: 'Bank Transfer' });
    expect([printPartyLabel('IV'), printPartyLabel('RE'), printPartyLabel('RR'), printPartyLabel('PS'), printPartyLabel('RL'), printPartyLabel('GL')]).toEqual(['ลูกค้า', 'ลูกค้า', 'ผู้จำหน่าย', 'ผู้จำหน่าย', '', '']);
  });
  it('กฎรับรอง/พิมพ์ซ้ำ', () => {
    const r = { approveLevel: 5, method: '2', reprintLevel: 7 };
    expect(checkPrint(r, { printCount: 0, approved: false, cancelled: false }, 9)).toMatch(/ต้องรับรองก่อนพิมพ์/);
    expect(checkPrint(r, { printCount: 0, approved: true, cancelled: false }, 1)).toBeNull();
    expect(checkPrint(r, { printCount: 2, approved: true, cancelled: false }, 6)).toMatch(/พิมพ์ซ้ำต้องใช้ผู้มีระดับอนุมัติตั้งแต่ 7/);
    expect(checkPrint(r, { printCount: 2, approved: true, cancelled: false }, 6, true)).toBeNull();
    expect(checkApprove(r, { printCount: 0, approved: false, cancelled: false }, 4)).toMatch(/ตั้งแต่ 5/);
    expect(checkApprove(r, { printCount: 0, approved: false, cancelled: false }, 5)).toBeNull();
    expect(checkApprove({ ...r, method: '1' }, { printCount: 0, approved: false, cancelled: false }, 9)).toMatch(/พิมพ์ก่อนรับรอง/);
    expect(checkApprove({ ...r, approveLevel: 0 }, { printCount: 0, approved: false, cancelled: false }, 9)).toMatch(/ไม่ต้องรับรอง/);
    expect(checkApprove(r, { printCount: 1, approved: true, cancelled: false }, 9)).toMatch(/รับรองแล้ว/);
    expect(checkUnapprove(r, { printCount: 1, approved: true, cancelled: false }, 3)).toMatch(/ตั้งแต่ 5/);
  });
});
