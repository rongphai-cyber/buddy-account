import { describe, expect, it } from 'vitest';
import { checkApprove, checkPrint, checkUnapprove, copyMark, defaultLayout, sheetCopies, docMenuOf, docPath, normalizeLayout, printFamily, printMenu, printLabelEn, printPartyLabel, printTextEn, printTitle, PRINT_FONTS, PRINT_POS9, receiptItemTotals } from './printforms.js';
import { bahtTextEn } from './baht.js';
import { formatDateEn } from './date.js';

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
    expect(l.columns.slice(0, 2).map((c) => `${c.key}:${c.label}:${c.width}:${c.show}`)).toEqual(['amount:Amount:80:true', 'name:รายละเอียด:30:false']);
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

describe('แบบฟอร์มพิมพ์: ส่วนหัว/ส่วนกลาง/ภาษาอังกฤษ (HANDOFF 151)', () => {
  it('ฟอร์มเดิม (ไม่มีค่าใหม่) = หน้าตาเดิม: ชื่อบริษัทซ้าย ชื่อเอกสารขวา ไม่มีขนาด/สีพิเศษ ภาษาไทย', () => {
    const L = normalizeLayout('IV', 'pro', { title: 'x', font_pt: 11 });
    expect([L.co_align, L.title_align, L.co_name_pt, L.co_name_color, L.title_pt, L.band_color, L.body_pt, L.body_color, L.lang]).toEqual(['left', 'right', 0, '', 0, '', 0, '', 'th']);
    expect(L.signatures_en).toEqual(['Received by', 'Delivered by', 'Authorized Signature']);
    expect(L.columns.find((c) => c.key === 'price')?.label_en).toBe('Unit Price');
  });
  it('ตัดค่าที่ผิด: สีต้องเป็น #rrggbb · ขนาด 6–40 pt · ตำแหน่ง left/center/right · ภาษา th/en', () => {
    const L = normalizeLayout('IV', 'pro', { co_align: 'center', title_align: 'top', co_name_pt: 22, title_pt: 3, title_color: '#AB12CD', band_color: 'red', body_pt: 9.3, lang: 'en', signatures_en: ['Buyer', 7] });
    expect([L.co_align, L.title_align, L.co_name_pt, L.title_pt, L.title_color, L.band_color, L.body_pt, L.lang]).toEqual(['center', 'right', 22, 0, '#ab12cd', '', 9.5, 'en']);
    expect(L.signatures_en).toEqual(['Buyer', '']);
  });
  it('หัวคอลัมน์ภาษาอังกฤษ: ตั้งเองได้ ว่าง = ค่าเริ่มต้น', () => {
    const L = normalizeLayout('IV', 'pro', { columns: [{ key: 'name', label: 'สินค้า', label_en: 'Goods' }, { key: 'qty', label: 'จำนวน', label_en: ' ' }] });
    expect(L.columns.slice(0, 2).map((c) => c.label_en)).toEqual(['Goods', 'Qty']);
  });
  it('คำกำกับยอดรวม/สำเนาเป็นภาษาอังกฤษ', () => {
    expect(['รวมเงิน', 'ส่วนลด 5%', 'หักเงินมัดจำ', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม 7%', 'ภาษีมูลค่าเพิ่มของผลต่าง 7%', 'จำนวนเงินรวมทั้งสิ้น', 'ส่วนลดเงินสด', 'ค่าขนส่งพิเศษ'].map(printLabelEn))
      .toEqual(['Subtotal', 'Discount 5%', 'Less Deposit', 'Value of Goods/Services', 'VAT 7%', 'VAT on Difference 7%', 'Grand Total', 'Cash Discount', 'ค่าขนส่งพิเศษ']);
    expect(['ต้นฉบับ', 'สำเนา (ลูกค้า)', 'สำนักงานใหญ่', 'สาขาที่ 00002'].map(printTextEn)).toEqual(['ORIGINAL', 'COPY (ลูกค้า)', 'Head Office', 'Branch 00002']);
  });
  it('จำนวนเงินเป็นตัวอักษรภาษาอังกฤษ · วันที่ภาษาอังกฤษ', () => {
    expect(bahtTextEn('27124.50')).toBe('Twenty-Seven Thousand One Hundred Twenty-Four Baht and Fifty Satang');
    expect(bahtTextEn('100')).toBe('One Hundred Baht Only');
    expect(bahtTextEn('1000000.01')).toBe('One Million Baht and One Satang');
    expect(bahtTextEn('0.75')).toBe('Seventy-Five Satang');
    expect(bahtTextEn('115')).toBe('One Hundred Fifteen Baht Only');
    expect(bahtTextEn(0)).toBe('Zero Baht Only');
    expect(formatDateEn('2026-11-19')).toBe('19 Nov 2026');
    expect(formatDateEn('2027-01-05')).toBe('5 Jan 2027');
  });
});

describe('print form header grid, top bar, font, second name line (HANDOFF 152)', () => {
  it('old saved forms get the old look: top row, theme top bar, template font, second name line follows the address', () => {
    const L = normalizeLayout('IV', 'pro', { co_align: 'right', title_align: 'left' });
    expect([L.logo_v, L.co_v, L.title_v, L.top_bar, L.font, L.co_name2_pt, L.co_name2_color]).toEqual(['top', 'top', 'top', '', '', 0, '']);
    expect([L.co_align, L.title_align]).toEqual(['right', 'left']);
  });
  it('drops bad values: vertical position, top bar colour/none, font outside the list', () => {
    const L = normalizeLayout('IV', 'pro', { logo_v: 'bottom', co_v: 'middle', title_v: 'up', top_bar: 'none', font: 'Kanit', co_name2_pt: 11, co_name2_color: '#00AA00' });
    expect([L.logo_v, L.co_v, L.title_v, L.top_bar, L.font, L.co_name2_pt, L.co_name2_color]).toEqual(['bottom', 'middle', 'top', 'none', 'Kanit', 11, '#00aa00']);
    const M = normalizeLayout('IV', 'pro', { top_bar: 'red', font: 'Comic Sans MS' });
    expect([M.top_bar, M.font]).toEqual(['', '']);
    expect(normalizeLayout('IV', 'pro', { top_bar: '#123ABC' }).top_bar).toBe('#123abc');
  });
  it('nine positions in reading order', () => {
    expect(PRINT_POS9.map((p) => p.label)).toEqual(['ซ้ายบน', 'กลางบน', 'ขวาบน', 'ซ้ายกลาง', 'กึ่งกลาง', 'ขวากลาง', 'ซ้ายล่าง', 'กลางล่าง', 'ขวาล่าง']);
    expect(PRINT_FONTS[0]!.key).toBe('');
  });
  it('plain template keeps the company header off by default (pre-printed stationery)', () => {
    expect([defaultLayout('IV', 'plain').show_company, defaultLayout('IV', 'plain').logo]).toEqual([false, 'none']);
    expect(defaultLayout('IV', 'pro').show_company).toBe(true);
  });
});

describe('receipt with item detail: totals from the original invoices (HANDOFF 153)', () => {
  const inv = (amount: number, vat: number, x: Record<string, unknown> = {}) => ({ amount: String(amount + vat), net_amount: String(amount + vat), vat_rate: '7', inv_amount: String(amount), inv_after: String(amount), inv_price_type: '2', inv_taxable: String(amount), inv_vat: String(vat), ...x });
  const base = { vatBlock: [], adjBefore: [], adjAfter: [] };
  const t = (rows: Parameters<typeof receiptItemTotals>[0], x: Partial<Parameters<typeof receiptItemTotals>[1]>) => receiptItemTotals(rows, { paid: 0, vatDue: 0, issued: 0, net: 0, ...base, ...x }).map((l) => `${l.label}=${l.value}`);
  it('goods invoices paid in full: value / VAT / grand total (no duplicate รวมเงิน)', () => {
    expect(t([inv(100, 7), inv(200, 14)], { paid: 321, issued: 321, net: 321 })).toEqual(['มูลค่าสินค้า/บริการ=300.00', 'ภาษีมูลค่าเพิ่ม 7%=21.00', 'จำนวนเงินรวมทั้งสิ้น=321.00']);
  });
  it('part payment: invoice total, then the amount paid this time and the net', () => {
    expect(t([inv(100, 7), inv(200, 14, { amount: '43' })], { paid: 150, issued: 150, net: 150 })).toEqual(['มูลค่าสินค้า/บริการ=300.00', 'ภาษีมูลค่าเพิ่ม 7%=21.00', 'รวมตามใบแจ้งหนี้=321.00', 'ยอดชำระครั้งนี้=150.00', 'ยอดสุทธิ=150.00']);
  });
  it('service (cash-basis VAT) paid in full: the invoice figures are the tax invoice figures', () => {
    expect(t([inv(100, 7)], { paid: 107, vatDue: 7, net: 107 })).toEqual(['มูลค่าสินค้า/บริการ=100.00', 'ภาษีมูลค่าเพิ่ม 7%=7.00', 'จำนวนเงินรวมทั้งสิ้น=107.00']);
  });
  it('goods + service on one receipt: VAT of this receipt only, goods paid on tax invoices already issued', () => {
    const vatBlock = [{ label: 'มูลค่าสินค้า/บริการที่มีภาษีมูลค่าเพิ่ม', value: '200.00' }, { label: 'ภาษีมูลค่าเพิ่ม 7%', value: '14.00' }, { label: 'ชำระตามใบกำกับภาษีที่ออกแล้ว', value: '107.00' }];
    expect(t([inv(100, 7), inv(200, 14)], { paid: 321, vatDue: 14, issued: 107, net: 321, vatBlock }))
      .toEqual(['รวมตามใบแจ้งหนี้=321.00', 'มูลค่าสินค้า/บริการที่มีภาษีมูลค่าเพิ่ม=200.00', 'ภาษีมูลค่าเพิ่ม 7%=14.00', 'ชำระตามใบกำกับภาษีที่ออกแล้ว=107.00', 'ยอดสุทธิ=321.00']);
  });
  it('discounts, VAT-inclusive invoices, credit notes deducted, cash discount', () => {
    const incl = inv(0, 0, { amount: '107', net_amount: '107', inv_amount: '107', inv_after: '107', inv_price_type: '1', inv_taxable: '107', inv_vat: '7' });
    const disc = inv(100, 6.3, { amount: '96.3', net_amount: '96.3', inv_discount: '10', inv_discount_text: '10', inv_after: '90', inv_taxable: '90' });
    const cn = inv(10, 0.7, { express_rectype: '5' });
    expect(t([incl, disc, cn], { paid: 192.6, issued: 192.6, net: 190.6, adjBefore: [{ label: 'ส่วนลดเงินสด', value: '2.00' }] }))
      .toEqual(['รวมเงิน=197.00', 'ส่วนลด 10=10.00', 'หลังหักส่วนลด=187.00', 'มูลค่าสินค้า/บริการ=180.00', 'ภาษีมูลค่าเพิ่ม 7%=12.60', 'รวมตามใบแจ้งหนี้=192.60', 'ส่วนลดเงินสด=2.00', 'ยอดสุทธิ=190.60']);
  });
  it('English words for the new lines and the partly-paid reference', () => {
    expect(['ยอดชำระครั้งนี้', 'รวมตามใบแจ้งหนี้', 'ชำระตามใบกำกับภาษีที่ออกแล้ว'].map(printLabelEn)).toEqual(['Paid This Receipt', 'Total per Invoices', 'Paid on Tax Invoices Already Issued']);
    expect(printTextEn('IV0000137 (2026-11-04) ชำระบางส่วน')).toBe('IV0000137 (2026-11-04) partly paid');
  });
});
