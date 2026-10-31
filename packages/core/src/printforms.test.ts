import { describe, expect, it } from 'vitest';
import { checkApprove, checkPrint, checkUnapprove, defaultLayout, docMenuOf, docPath, normalizeLayout, printFamily, printMenu } from './printforms.js';

describe('แบบฟอร์มพิมพ์เอกสาร (S-RD-01/02)', () => {
  it('จัดกลุ่มเอกสารและเมนูสิทธิ์', () => {
    expect([printFamily('IV'), printFamily('RE'), printFamily('BS'), printFamily('OE'), printFamily('OU'), printFamily('BD'), printFamily('DP'), printFamily('GL')])
      .toEqual(['trade', 'settle', 'bill', 'cash', 'stock', 'bank', 'petty', 'journal']);
    expect([docMenuOf('IV'), docMenuOf('PS'), docMenuOf('RL'), docMenuOf('BT'), docMenuOf('VR'), docMenuOf('IV', true), docMenuOf('GL')]).toEqual(['SA.IV', 'FI.AP.PS', 'IC.TRN', 'FI.BK.TX', 'GL.PC', 'FI.AR.OB', 'GL.JNL']);
    expect([docPath('IV', 'x'), docPath('IV', 'x', true), docPath('RR', 'x', true), docPath('PS', 'x'), docPath('BT', 'x'), docPath('RL', 'x'), docPath('DP', 'x'), docPath('VR', 'x'), docPath('BQ', 'x'), docPath('OS', 'x', true), docPath('GL', 'x'), docPath('ZZ', 'x'), docPath(null, 'x')])
      .toEqual(['/sa/invoices/x', '/fi/ar/opening/x', '/fi/ap/opening/x', '/fi/ap/payments/x', '/fi/bank/transfers/x', '/ic/transfers/x', '/gl/petty-cash/dp/x', '/gl/petty-cash/vr/x', '/fi/cheques/slips/x', '/ic/opening/x', '/gl/journals/x', null, null]);
  });
  it('ต้นแบบ 1–4 + ฟอร์มของบริษัททับหมายเลขเดิม / ปิดหมายเลขได้', () => {
    const m = printMenu('IV', [{ slot: 1, name: 'ใบกำกับภาษี บริษัท', base: 'plain', layout: { title: 'ใบกำกับภาษี', copies: ['ต้นฉบับ'] } }, { slot: 4, name: 'x', base: 'grid', layout: {}, status: 'I' }, { slot: 7, name: 'ใบส่งของ', base: 'half', layout: {} }], 'ขายเงินเชื่อ');
    expect(m.map((x) => `${x.slot}${x.custom ? '*' : ''}:${x.base}`)).toEqual(['1*:plain', '2:plain', '3:half', '7*:half']);
    expect(m[0]!.layout.title).toBe('ใบกำกับภาษี');
    expect(m[3]!.layout.title).toBe('ขายเงินเชื่อ');
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
    expect(printMenu('RE', []).map((f) => `${f.slot}:${f.layout.settle_detail}`)).toEqual(['1:auto', '2:auto', '3:auto', '4:auto', '5:items']);
    expect(printMenu('IV', []).length).toBe(4);
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
