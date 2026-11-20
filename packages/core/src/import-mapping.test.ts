import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, headerSignature, importMapKey, mapColumns, mapDate, mapNumber, mapSchema, missingCodeRows, normalizeMapping, setImportCodes, unmappedRequired, type ImportMapping } from './import-mapping.js';
import { mapExpenseImport, mapImport } from './trade-import.js';
import { computeDoc, TRADE_KINDS } from './doc-calc.js';
import { d } from './money.js';
import { mapJournalImport } from './journal-import.js';

/** Anthropic structured outputs: at most 16 union-typed parameters — keep 0 (HANDOFF 166 rule) */
function unionParams(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const n = node as Record<string, unknown>;
  let c = Array.isArray(n.type) || Array.isArray(n.anyOf) ? 1 : 0;
  for (const v of Object.values(n)) c += Array.isArray(v) ? v.reduce((t: number, x) => t + unionParams(x), 0) : unionParams(v);
  return c;
}
const base: ImportMapping = { header_row: 0, columns: [], date_order: 'dmy', year: 'auto', decimal: 'dot', group: 'column', skip_words: [], notes: '' };

describe('ให้ AI จัดรูปแบบ Excel (HANDOFF 168)', () => {
  it('dates: BE/CE, 2-digit years, Thai month names, Excel serials, time suffix; unreadable stays as-is', () => {
    expect(mapDate('15/10/2569', 'dmy', 'auto')).toBe('2026-10-15');
    expect(mapDate('15-10-69', 'dmy', 'be')).toBe('2026-10-15');
    expect(mapDate('15.10.26', 'dmy', 'ce')).toBe('2026-10-15');
    expect(mapDate('10/15/2026', 'mdy', 'ce')).toBe('2026-10-15');
    expect(mapDate('2569-10-15', 'ymd', 'be')).toBe('2026-10-15');
    expect(mapDate('15 ต.ค. 2569', 'dmy', 'be')).toBe('2026-10-15');
    expect(mapDate('15 ตุลาคม 69', 'dmy', 'auto')).toBe('2026-10-15');
    expect(mapDate('๑๕/๑๐/๒๕๖๙ 10:30', 'dmy', 'auto')).toBe('2026-10-15');
    expect(mapDate('45945', 'dmy', 'auto')).toBe('45945');          // Excel serial → the importer converts it
    expect(mapDate('31/02/2569', 'dmy', 'be')).toBe('31/02/2569');  // no such date → importer reports the row
    expect(mapDate('ไม่ระบุ', 'dmy', 'be')).toBe('ไม่ระบุ');
  });

  it('numbers: thousands, comma decimals, (negative), trailing minus, baht sign, dash = empty', () => {
    expect(mapNumber('1,234.50', 'dot')).toBe('1234.50');
    expect(mapNumber('1.234,50', 'comma')).toBe('1234.50');
    expect(mapNumber('(500.00)', 'dot')).toBe('-500.00');
    expect(mapNumber('500-', 'dot')).toBe('-500');
    expect(mapNumber('฿ 1,000 บาท', 'dot')).toBe('1000');
    expect(mapNumber('-', 'dot')).toBe('');
    expect(mapNumber('๑,๒๐๐', 'dot')).toBe('1200');
    expect(mapNumber('abc', 'dot')).toBe('abc');
  });

  it('schema has no union types and only this target\'s columns; normalize drops bad targets/sources', () => {
    for (const t of ['trade', 'expense', 'journal'] as const) expect(unionParams(mapSchema(t))).toBe(0);
    expect(mapSchema('expense').properties.columns.items.properties.target.enum).toContain('wht_rate');
    const m = normalizeMapping({ header_row: 40, columns: [{ target: 'date', source: 1, constant: '' }, { target: 'date', source: 2, constant: '' }, { target: 'nope', source: 0, constant: '' }, { target: 'qty', source: 9, constant: '' }, { target: 'unit', source: -1, constant: ' กล่อง ' }],
      date_order: 'xyz' as never, year: 'be', decimal: 'dot', group: 'continue', skip_words: [' รวม ', ''], notes: 'ok' }, 'trade', 5);
    expect(m).toEqual({ header_row: 19, columns: [{ target: 'date', source: 1, constant: '' }, { target: 'unit', source: -1, constant: 'กล่อง' }], date_order: 'dmy', year: 'be', decimal: 'dot', group: 'continue', skip_words: ['รวม'], notes: 'ok' });
    expect(unmappedRequired(m, 'trade').map((c) => c.key)).toEqual(['party', 'item', 'qty']);   // ref not needed when rows continue
    expect(unmappedRequired({ ...m, group: 'column' }, 'trade').map((c) => c.key)).toEqual(['ref', 'party', 'item', 'qty']);
  });

  it('header signature ignores spacing/case/punctuation and trailing empty cells; setting key fits 40 chars', () => {
    expect(headerSignature(['เลขที่ บิล', 'Date', ''])).toBe(headerSignature(['เลขที่บิล ', 'date']));
    expect(headerSignature(['เลขที่บิล', 'date'])).not.toBe(headerSignature(['date', 'เลขที่บิล']));
    expect(headerSignature(['a'])).toMatch(/^[0-9a-f]{8}$/);
    expect(importMapKey('OE', headerSignature(['a'])).length).toBeLessThanOrEqual(40);
  });

  it('messy OCR purchase file → standard rows: title lines, BE dates, (negatives), continuation rows, totals and repeated headers skipped; row numbers kept', () => {
    const rows = [
      ['รายงานซื้อ เดือน ต.ค. 2569'],
      [],
      ['เลขที่บิล', 'ว/ด/ป', 'ผู้ขาย', 'รายการ', 'จำนวน', 'ราคา/หน่วย', 'หมายเหตุ'],
      ['B-01', '15 ต.ค. 2569', 'S001', 'กระดาษ A4', '10', '1,200.00', ''],
      ['', '', '', 'ค่าส่ง', '1', '(50.00)', ''],
      ['B-02', '16/10/69', 'S002', 'หมึกพิมพ์', '2', '350', 'ด่วน'],
      ['เลขที่บิล', 'ว/ด/ป', 'ผู้ขาย', 'รายการ', 'จำนวน', 'ราคา/หน่วย', 'หมายเหตุ'],
      ['', '', '', 'รวมทั้งสิ้น', '', '12,700.00', ''],
      ['', '', '', '', '', '', ''],
    ];
    const m = normalizeMapping({ header_row: 2, columns: [{ target: 'ref', source: 0, constant: '' }, { target: 'date', source: 1, constant: '' }, { target: 'party', source: 2, constant: '' },
      { target: 'description', source: 3, constant: '' }, { target: 'qty', source: 4, constant: '' }, { target: 'price', source: 5, constant: '' }, { target: 'remark', source: 6, constant: '' }],
    date_order: 'dmy', year: 'be', decimal: 'dot', group: 'continue', skip_words: ['รวม'], notes: '' }, 'trade', 7);
    const r = applyMapping(rows, m, 'trade');
    expect(r.rowShift).toBe(0);
    expect(r.table[2]).toEqual(['เลขที่อ้างอิง', 'วันที่', 'รหัสคู่ค้า', 'รายละเอียด', 'จำนวน', 'ราคาต่อหน่วย', 'หมายเหตุ']);
    expect(r.table[3]).toEqual(['B-01', '2026-10-15', 'S001', 'กระดาษ A4', '10', '1200.00', '']);
    expect(r.table[4]).toEqual(['B-01', '2026-10-15', 'S001', 'ค่าส่ง', '1', '-50.00', '']);   // continuation row inherits the document head
    expect(r.table[5]).toEqual(['B-02', '2026-10-16', 'S002', 'หมึกพิมพ์', '2', '350', 'ด่วน']);
    expect(r.skipped).toEqual([7, 8]);
    expect([r.table[0], r.table[6], r.table[7]]).toEqual([[], [], []]);
    // description only (no item code column) → the importer asks for codes; code suggestions find those rows (file row numbers)
    const std = mapImport(r.table, 'B');
    expect(std.errors).toEqual([{ row: 3, message: 'ไม่มีคอลัมน์ "รหัสสินค้า" — ใช้ชื่อหัวคอลัมน์ตามแบบฟอร์มตัวอย่าง' }]);
    expect(missingCodeRows(r.table, 'trade')).toEqual([{ row: 4, text: 'กระดาษ A4', amount: '1200.00' }, { row: 5, text: 'ค่าส่ง', amount: '-50.00' }, { row: 6, text: 'หมึกพิมพ์', amount: '350' }]);
    // the user accepts codes → the importer gets them (code column added; existing codes never overwritten)
    const coded = setImportCodes(r.table, 'trade', { 4: 'P-A4', 5: 'SV-SHIP', 6: 'P-INK', 7: 'X' });
    const ok = mapImport(coded, 'B');
    expect(ok.errors).toEqual([]);
    expect(ok.docs.map((x) => [x.ref, x.row, x.date, x.party, x.lines.map((l) => [l.row, l.item, l.qty, l.price])])).toEqual([
      ['B-01', 4, '2026-10-15', 'S001', [[4, 'P-A4', '10', '1200.00'], [5, 'SV-SHIP', '1', '-50.00']]], ['B-02', 6, '2026-10-16', 'S002', [[6, 'P-INK', '2', '350']]]]);
    expect(setImportCodes(coded, 'trade', { 4: 'OTHER' })[3]).toEqual(coded[3]);
  });

  it('OE file without document numbers (one row = one document), constant expense code, comma decimals', () => {
    const rows = [['วันที่', 'จ่ายให้', 'ค่าอะไร', 'ยอด'], ['01/11/2569', 'แท็กซี่', 'ไปธนาคาร', '120,00'], ['02/11/2569', 'ร้านกาแฟ', 'รับรองลูกค้า', '1.250,50']];
    const m = normalizeMapping({ header_row: 0, columns: [{ target: 'date', source: 0, constant: '' }, { target: 'party_name', source: 1, constant: '' }, { target: 'description', source: 2, constant: '' },
      { target: 'amount', source: 3, constant: '' }, { target: 'code', source: -1, constant: 'E-01' }], date_order: 'dmy', year: 'auto', decimal: 'comma', group: 'row', skip_words: [], notes: '' }, 'expense', 4);
    expect(unmappedRequired(m, 'expense')).toEqual([]);
    const r = applyMapping(rows, m, 'expense');
    const x = mapExpenseImport(r.table, 'B');
    expect(x.errors).toEqual([]);
    expect(x.docs.map((d) => [d.ref, d.date, d.party_name, d.lines.map((l) => [l.code, l.description, l.amount])])).toEqual([
      ['R2', '2026-11-01', 'แท็กซี่', [['E-01', 'ไปธนาคาร', '120.00']]], ['R3', '2026-11-02', 'ร้านกาแฟ', [['E-01', 'รับรองลูกค้า', '1250.50']]]]);
  });

  it('journal export from another program: no header row, book as constant, Dr/Cr columns, blank group continues the voucher', () => {
    const rows = [['15/10/2569', 'ADJ-1', 'ค่าเช่า ต.ค.', '5310-01', '10,000.00', ''], ['', '', '', '2120-00', '', '10,000.00'], ['16/10/2569', 'ADJ-2', 'ค่าน้ำ', '5320-00', '500', ''], ['', '', '', '1111-00', '', '500']];
    const m = normalizeMapping({ header_row: -1, columns: [{ target: 'book', source: -1, constant: 'JV' }, { target: 'date', source: 0, constant: '' }, { target: 'ref', source: 1, constant: '' }, { target: 'description', source: 2, constant: '' },
      { target: 'account', source: 3, constant: '' }, { target: 'debit', source: 4, constant: '' }, { target: 'credit', source: 5, constant: '' }], date_order: 'dmy', year: 'be', decimal: 'dot', group: 'continue', skip_words: [], notes: '' }, 'journal', 6);
    expect(unmappedRequired(m, 'journal')).toEqual([]);
    const r = applyMapping(rows, m, 'journal');
    expect(r.rowShift).toBe(1);
    const j = mapJournalImport(r.table, 'B');
    expect(j.errors).toEqual([]);
    expect(j.vouchers.map((v) => [v.book, v.group, v.date, v.ref, v.debit, v.credit, v.lines.map((l) => l.account)])).toEqual([
      ['JV', 'R2', '2026-10-15', 'ADJ-1', '10000.00', '10000.00', ['5310-01', '2120-00']], ['JV', 'R4', '2026-10-16', 'ADJ-2', '500.00', '500.00', ['5320-00', '1111-00']]]);
    expect(missingCodeRows(r.table, 'journal')).toEqual([]);
  });

  it('every target exposes its columns with formats for the review screen', () => {
    expect(mapColumns('trade').find((c) => c.key === 'price')?.format).toBe('number');
    expect(mapColumns('expense').find((c) => c.key === 'date')?.format).toBe('date');
    expect(mapColumns('journal').filter((c) => c.required).map((c) => c.key)).toEqual(['book', 'group', 'date', 'account']);
  });

  it('guess without AI: header row = most text cells; columns by template names/aliases', () => {
    const g = guessMapping([['บริษัท ก'], ['เลขที่บิล', 'วันที่', 'รหัสผู้จำหน่าย', 'สินค้า', 'qty', 'ราคา', 'อะไรก็ได้'], ['1', '1/1/2569', 'S1', 'A', '1', '5', '']], 'trade');
    expect(g.header_row).toBe(1);
    expect(g.columns).toEqual([{ target: 'ref', source: 0, constant: '' }, { target: 'date', source: 1, constant: '' }, { target: 'party', source: 2, constant: '' }, { target: 'item', source: 3, constant: '' },
      { target: 'qty', source: 4, constant: '' }, { target: 'price', source: 5, constant: '' }]);
    expect(guessMapping([['1', '2']], 'journal').header_row).toBe(-1);
  });

  /** แฟ้มส่งออกใบเสร็จรับเงินจากโปรแกรมอื่น (รูปแบบเดียวกับแฟ้มจริงของเจ้าของ 20/11/2569 — ข้อมูลสมมุติ ไม่มีชื่อจริง) */
  const RECEIPTS = [
    ['ใบเสร็จรับเงิน', 'สถานะ', 'วันที่', 'ชื่อลูกค้า', 'ชื่อโปรเจกต์', 'รหัสสินค้า', 'สินค้า', 'รายละเอียด', 'จำนวน', 'ราคาต่อหน่วย (ไม่รวมภาษี)', 'ส่วนลด (ไม่รวมภาษี)', 'ราคารวม (ไม่รวมภาษี)', 'ภาษี VAT', 'ราคาสุทธิ'],
    ['RE-261001001', 'รับเงินแล้ว', '46296', 'ลูกค้าสมมุติ หนึ่ง', 'คอร์สตัวอย่าง', 'CRS-01', 'ค่าคอร์สเรียน', 'รุ่นที่ 1', '1', '5854.2056074766', '0', '5854.2056074766', '409.79439252336', '6264'],
    ['RE-261001001', 'รับเงินแล้ว', '46296', 'ลูกค้าสมมุติ หนึ่ง', 'คอร์สตัวอย่าง', 'MEM-01', 'ค่าสมาชิก', 'รายปี', '1', '350', '0', '350', '', '350'],
    ['RE-261001002', 'รับเงินแล้ว', '46297', 'ลูกค้าสมมุติ สอง', 'คอร์สตัวอย่าง', 'CRS-01', 'ค่าคอร์สเรียน', 'รุ่นที่ 1', '2', '5854.2056074766', '0', '11708.4112149532', '819.588785046724', '12528'],
    ['RE-261001003', 'รับเงินแล้ว', '46297', 'ลูกค้าสมมุติ หนึ่ง', '', 'MEM-01', 'ค่าสมาชิก', '', '1', '350', '0', '350', '', '350'],
  ];
  const HS = TRADE_KINDS.find((k) => k.cls === 'HS')!;
  const receiptTotals = (table: string[][], m: ImportMapping) => {
    const r = mapImport(applyMapping(table, m, 'trade').table, 'B', HS);
    return { r, totals: r.docs.map((x) => {
      const c = computeDoc({ price_type: '2', vat_rate: 7, lines: x.lines.map((l) => ({ qty: l.qty, unit_price: l.price, discount_text: l.discount, vat_code: l.vat_code ?? '1' })) });
      return [x.ref, c.vat_amount, c.net_amount, x.lines.reduce((t, l) => t.plus(d(l.net_total ?? 0)), d(0)).toFixed(2)];
    }) };
  };
  it('HANDOFF 170: receipt export from another program (guess without AI) → receipt number groups bills, names, mixed VAT per line, totals = the file', () => {
    const g = guessMapping(RECEIPTS, 'trade', HS);
    expect(g.header_row).toBe(0);
    expect(Object.fromEntries(g.columns.map((c) => [c.target, c.source]))).toEqual({ doc_no: 0, date: 2, party_name: 3, item: 5, item_name: 6, description: 7, qty: 8, price: 9, discount: 10, vat_amount: 12, net_total: 13 });
    expect(unmappedRequired(g, 'trade', HS)).toEqual([]);
    const { r, totals } = receiptTotals(RECEIPTS, g);
    expect(r.errors).toEqual([]);
    expect(r.docs.map((x) => [x.ref, x.doc_no, x.date, x.party_name, x.lines.map((l) => `${l.item}:${l.vat_code}:${l.price}`).join(' ')])).toEqual([
      ['RE-261001001', 'RE-261001001', '2026-10-01', 'ลูกค้าสมมุติ หนึ่ง', 'CRS-01:1:5854.2056 MEM-01:0:350'],
      ['RE-261001002', 'RE-261001002', '2026-10-02', 'ลูกค้าสมมุติ สอง', 'CRS-01:1:5854.2056'],
      ['RE-261001003', 'RE-261001003', '2026-10-02', 'ลูกค้าสมมุติ หนึ่ง', 'MEM-01:0:350'],
    ]);
    // ราคาไม่รวม VAT ทศนิยมยาว: ยอดบรรทัด 5,854.21 · VAT 409.79 · รวม 6,264.00 — ทุกใบเท่ากับ "ราคาสุทธิ" รวมในแฟ้ม
    expect(totals).toEqual([['RE-261001001', '409.79', '6614.00', '6614.00'], ['RE-261001002', '819.59', '12528.00', '12528.00'], ['RE-261001003', '0.00', '350.00', '350.00']]);
  });
  it('HANDOFF 170: the same file with an AI-style mapping (mocked answer) gives the same documents', () => {
    const ai = normalizeMapping({ header_row: 0, date_order: 'dmy', year: 'auto', decimal: 'dot', group: 'column', skip_words: [], notes: 'ราคาไม่รวมภาษี — เลือกประเภทราคา "ไม่รวม VAT"',
      columns: [{ target: 'doc_no', source: 0, constant: '' }, { target: 'date', source: 2, constant: '' }, { target: 'party_name', source: 3, constant: '' }, { target: 'item', source: 5, constant: '' },
        { target: 'item_name', source: 6, constant: '' }, { target: 'description', source: 7, constant: '' }, { target: 'qty', source: 8, constant: '' }, { target: 'price', source: 9, constant: '' },
        { target: 'vat_amount', source: 12, constant: '' }, { target: 'net_total', source: 13, constant: '' }] }, 'trade', 14);
    expect(receiptTotals(RECEIPTS, ai).totals).toEqual(receiptTotals(RECEIPTS, guessMapping(RECEIPTS, 'trade', HS)).totals);
    // continuation rows (receipt number only on the first row of each bill) still group by the number
    const cont = RECEIPTS.map((r, i) => (i === 2 ? ['', ...r.slice(1)] : r));
    const c = receiptTotals(cont, { ...ai, group: 'continue' });
    expect(c.r.docs.map((x) => [x.ref, x.lines.length])).toEqual([['RE-261001001', 2], ['RE-261001002', 1], ['RE-261001003', 1]]);
    // the schema offers the new targets, still without union types
    const sch = mapSchema('trade', HS);
    expect(sch.properties.columns.items.properties.target.enum).toEqual(expect.arrayContaining(['doc_no', 'vat_amount', 'net_total']));
    expect(unionParams(sch)).toBe(0);
    expect(mapColumns('trade', HS).filter((c) => ['vat_amount', 'net_total'].includes(c.key)).map((c) => c.format)).toEqual(['number', 'number']);
  });
});
