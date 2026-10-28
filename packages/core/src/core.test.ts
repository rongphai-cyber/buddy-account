import { describe, it, expect } from 'vitest';
import { d, fmt, parseInput, round2 } from './money.js';
import { parseDateInput, formatDate, addMonths } from './date.js';
import { checkTaxId, taxIdCheckDigit } from './taxid.js';
import { validateJournal, journalTotals } from './journal.js';
import { runFsLayout, evalColumnFormula, type FsLine } from './fs-layout.js';
import { Decimal } from 'decimal.js';

describe('money', () => {
  it('formats Thai style', () => {
    expect(fmt('1234567.5')).toBe('1,234,567.50');
    expect(fmt('-12.3', { paren: true })).toBe('(12.30)');
    expect(fmt(0, { blankZero: true })).toBe('');
  });
  it('parses user input', () => {
    expect(parseInput('1,234.50')!.toFixed(2)).toBe('1234.50');
    expect(parseInput('(100)')!.toFixed(0)).toBe('-100');
    expect(parseInput('abc')).toBeNull();
  });
  it('rounds half up and stays exact', () => {
    expect(round2('2.345').toFixed(2)).toBe('2.35');
    expect(d('0.1').plus('0.2').toFixed(2)).toBe('0.30');
  });
});

describe('date (พ.ศ.)', () => {
  it('parses Express-style input', () => {
    expect(parseDateInput('15/03/2569', 'B')).toBe('2026-03-15');
    expect(parseDateInput('150369', 'B', '2026-01-01')).toBe('2026-03-15');
    expect(parseDateInput('15/3/69', 'B', '2026-01-01')).toBe('2026-03-15');
    expect(parseDateInput('31/02/2569', 'B')).toBeNull();
    expect(parseDateInput('1503', 'B', '2026-07-01')).toBe('2026-03-15');
    expect(parseDateInput('15/03/2026', 'C')).toBe('2026-03-15');
  });
  it('formats', () => {
    expect(formatDate('2026-03-15', 'B')).toBe('15/03/2569');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('tax id', () => {
  it('validates check digit', () => {
    const base = '010555500123';
    const full = base + taxIdCheckDigit(base);
    expect(checkTaxId(full).ok).toBe(true);
    expect(checkTaxId(base + ((taxIdCheckDigit(base) + 1) % 10)).ok).toBe(false);
    const legacy = checkTaxId('1234567890');
    expect(legacy.ok && legacy.kind).toBe('LEGACY10');
  });
});

describe('journal', () => {
  it('requires balanced, one-sided lines', () => {
    const ok = [{ account_id: 'a', debit: '100' }, { account_id: 'b', credit: '100.00' }];
    expect(validateJournal(ok)).toEqual([]);
    expect(journalTotals(ok).balanced).toBe(true);
    const bad = [{ account_id: 'a', debit: '100', credit: '5' }, { account_id: null, credit: '90' }];
    const msgs = validateJournal(bad).map((i) => i.message).join('|');
    expect(msgs).toMatch(/อย่างใดอย่างหนึ่ง/);
    expect(msgs).toMatch(/ยังไม่ได้ป้อนเลขที่บัญชี/);
    expect(msgs).toMatch(/ไม่เท่ากับเครดิต/);
  });
});

describe('financial statement layout (Express GLREP)', () => {
  const acct: Record<string, number> = { '1111-00': 100, '1112-01': 50, '1112-02': -20, '2100-00': 130 };
  const provider = {
    accountExists: (a: string) => a in acct,
    value: (kind: string, a: string) => (kind.includes('LY') ? new Decimal(acct[a]! / 2) : new Decimal(acct[a]!)),
  };
  const L = (n: number, dt: string, src: string | null, acc: Record<string, string> = {}, pc = '', f = '', text = ''): FsLine =>
    ({ line_no: n, data_type: dt, source: src, accumulate: acc, print_condition: pc, sign_filter: f, description_th: text, description_en: '' });
  it('accumulates variables, filters signs, evaluates % column', () => {
    const lines = [
      L(10, 'A/C', '1111-00', { A: '+' }, 'Z', '', 'เงินสด'),
      L(20, 'A/C', '1112-01', { C: '+' }, 'N', '+'),
      L(30, 'A/C', '1112-02', { C: '+' }, 'N', '+'),     // ติดลบ → กรองทิ้ง
      L(40, 'VAR', 'C', { A: '+', C: '0' }, 'Z', '', 'เงินฝาก (เฉพาะตัวดำ)'),
      L(50, '---', null),
      L(60, 'VAR', 'A', { A: '0' }, '', '', 'รวม'),
      L(70, 'A/C', '9999-99', {}, '', '', 'ไม่มีบัญชีนี้'),
    ];
    const { rows, missingAccounts } = runFsLayout(lines, [{ expr: 'BAL' }, { expr: 'BAL LY' }, { expr: '(C1-C2)*100/C2' }], provider);
    const vals = rows.filter((r) => r.kind === 'value').map((r) => (r.kind === 'value' ? r.values : []));
    expect(vals[0]).toEqual(['100.00', '50.00', '100.00']);
    expect(vals[1]).toEqual(['50.00', '25.00', '100.00']);
    expect(vals[2]).toEqual(['150.00', '75.00', '100.00']);
    expect(missingAccounts).toEqual(['9999-99']);
  });
  it('formula safety', () => {
    expect(evalColumnFormula('(C1-C2)*100/C2', [new Decimal(150), new Decimal(100)])!.toFixed(0)).toBe('50');
    expect(evalColumnFormula('C1/C2', [new Decimal(1), new Decimal(0)])).toBeNull();
    expect(evalColumnFormula('process.exit()', [])).toBeNull();
  });
});
