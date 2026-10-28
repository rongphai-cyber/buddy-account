import { d, round2, sum, ZERO, type MoneyInput, Decimal } from './money.js';

/** บรรทัดใบสำคัญที่ผู้ใช้ป้อน (ด้านเดียวต่อบรรทัด) */
export interface JournalLineInput {
  account_id: string | null;
  department_id?: string | null;
  description?: string | null;
  debit?: MoneyInput;
  credit?: MoneyInput;
}

export interface JournalIssue { line?: number; field?: string; message: string }

export interface JournalTotals { debit: Decimal; credit: Decimal; diff: Decimal; balanced: boolean }

export function journalTotals(lines: JournalLineInput[]): JournalTotals {
  const debit = round2(sum(lines.map((l) => l.debit)));
  const credit = round2(sum(lines.map((l) => l.credit)));
  const diff = debit.minus(credit);
  return { debit, credit, diff, balanced: diff.isZero() && !debit.isZero() };
}

/**
 * ตรวจใบสำคัญก่อนบันทึก (คู่มือบทที่ 15)
 * - ต้องมีอย่างน้อย 2 บรรทัดที่มียอด
 * - แต่ละบรรทัดต้องมีบัญชี และมียอดด้านเดียว ไม่ติดลบ
 * - เดบิตรวม = เครดิตรวม
 * - บัญชีต้องเป็นบัญชีย่อย (ไม่ใช่บัญชีคุม) — ตรวจผ่าน isPostable
 */
export function validateJournal(
  lines: JournalLineInput[],
  opts: { isPostable?: (accountId: string) => boolean | string } = {},
): JournalIssue[] {
  const issues: JournalIssue[] = [];
  const used = lines.map((l, i) => ({ l, i })).filter(({ l }) => !d(l.debit).isZero() || !d(l.credit).isZero() || l.account_id);
  if (used.filter(({ l }) => !d(l.debit).isZero() || !d(l.credit).isZero()).length < 2) issues.push({ message: 'ใบสำคัญต้องมีรายการอย่างน้อย 2 บรรทัด' });
  for (const { l, i } of used) {
    const dr = d(l.debit), cr = d(l.credit);
    if (!l.account_id) issues.push({ line: i, field: 'account_id', message: `บรรทัดที่ ${i + 1}: ยังไม่ได้ป้อนเลขที่บัญชี` });
    if (dr.isNegative() || cr.isNegative()) issues.push({ line: i, message: `บรรทัดที่ ${i + 1}: ยอดเงินติดลบไม่ได้` });
    if (!dr.isZero() && !cr.isZero()) issues.push({ line: i, message: `บรรทัดที่ ${i + 1}: ป้อนได้ทั้งเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง` });
    if (dr.isZero() && cr.isZero()) issues.push({ line: i, message: `บรรทัดที่ ${i + 1}: ยังไม่ได้ป้อนจำนวนเงิน` });
    if (l.account_id && opts.isPostable) {
      const r = opts.isPostable(l.account_id);
      if (r !== true) issues.push({ line: i, field: 'account_id', message: `บรรทัดที่ ${i + 1}: ${typeof r === 'string' ? r : 'บัญชีนี้ใช้บันทึกรายการไม่ได้'}` });
    }
  }
  const t = journalTotals(lines);
  if (!t.diff.isZero()) issues.push({ message: `ยอดเดบิต (${t.debit.toFixed(2)}) ไม่เท่ากับเครดิต (${t.credit.toFixed(2)}) ต่างกัน ${t.diff.abs().toFixed(2)}` });
  return issues;
}

/** ยอดบรรทัดแบบมีเครื่องหมาย (เดบิตบวก เครดิตลบ) */
export function signedAmount(l: { debit?: MoneyInput; credit?: MoneyInput }): Decimal {
  return d(l.debit).minus(d(l.credit));
}

/** แปลงยอดสุทธิเป็นคู่เดบิต/เครดิต */
export function splitSigned(net: MoneyInput): { debit: Decimal; credit: Decimal } {
  const n = d(net);
  return n.isNegative() ? { debit: ZERO, credit: n.neg() } : { debit: n, credit: ZERO };
}
