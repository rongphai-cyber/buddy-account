import { d, ZERO, Decimal } from './money.js';

/**
 * ตัวแปลแบบงบการเงินของ Express (คู่มือบทที่ 24: GLREP = หัวงบ/คอลัมน์, GLREPIT = บรรทัด)
 *
 * บรรทัด (data_type):
 *   A/C  ยอดของบัญชี (รวมบัญชีย่อยทั้งหมดใต้บัญชีนั้น)
 *   BEG  ยอดยกมาต้นปี/ต้นงวดของบัญชี (ใช้กับสินค้าต้นงวดในงบต้นทุน)
 *   INV  สินค้าคงเหลือปลายงวด (จากการตรวจนับ ถ้าไม่มีใช้ยอดบัญชี)
 *   VAR  แสดงค่าตัวแปร A–E
 *   TXT  ข้อความ · --- เส้นเดี่ยว · === เส้นคู่
 * print_condition: Z = ไม่แสดงถ้าเป็นศูนย์ทุกคอลัมน์, N = ไม่แสดง (คำนวณอย่างเดียว), C = ข้อความกึ่งกลาง
 * sign_filter: + ใช้เฉพาะยอดบวก, - ใช้เฉพาะยอดติดลบ (กลับเป็นบวก)
 * accumulate: ตัวแปร A–E แต่ละตัว '+' บวกเข้า, '-' ลบออก, '0' ล้างเป็นศูนย์ (หลังแสดง), '/' หาร
 * คอลัมน์: BAL ยอดสะสม ณ สิ้นงวด, PTD เฉพาะงวด, BAL LY / PTD LY ปีที่แล้ว, BAL LY2 / PTD LY2 สองปีก่อน, BUD / PTD BUD งบประมาณ, หรือสูตร เช่น (C1-C2)*100/C2
 */
export type FsDataType = 'A/C' | 'BEG' | 'INV' | 'VAR' | 'TXT' | '---' | '===';
export const FS_VARS = ['A', 'B', 'C', 'D', 'E'] as const;
export type FsVar = (typeof FS_VARS)[number];

export interface FsLine {
  line_no: number;
  data_type: string;
  source: string | null;
  sign_filter: string | null;
  print_condition: string | null;
  accumulate: Partial<Record<FsVar, string>> | null;
  description_th: string | null;
  description_en: string | null;
  department_code?: string | null;
}

export interface FsColumn { expr: string; head1?: string; head2?: string; department_code?: string | null }

export type FsRow =
  | { kind: 'text'; text: string; textEn: string; center: boolean; line_no: number }
  | { kind: 'rule'; double: boolean; line_no: number }
  | { kind: 'value'; text: string; textEn: string; values: (string | null)[]; account?: string; isTotal: boolean; line_no: number };

export interface FsValueProvider {
  /** ยอดตามด้านปกติของบัญชี (สินทรัพย์/ค่าใช้จ่ายเป็นบวกเมื่อเดบิต, หนี้สิน/ทุน/รายได้เป็นบวกเมื่อเครดิต); null = ไม่มีข้อมูล (เช่น ปีที่แล้วยังไม่มี) */
  value(kind: string, account: string, dataType: 'A/C' | 'BEG' | 'INV', departmentCode?: string | null): Decimal | null;
  accountExists(account: string): boolean;
}

/**
 * ชนิดคอลัมน์ของแบบงบ: BAL ยอดสะสม · PTD เฉพาะงวด · PTD1–PTD12 งวดที่ 1–12 ของปี (งบ 12 เดือน)
 * ต่อท้าย LY = ปีที่แล้ว · LY2 = 2 ปีก่อน (งบเปรียบเทียบ 3 ปี — HANDOFF 176) · BUD / PTD BUD / PTDn BUD = งบประมาณ (S-GL-17)
 * range: YTD | PTD | P1..P12 · lag: 0 ปีปัจจุบัน, 1 ปีที่แล้ว, 2 สองปีก่อน · null = ไม่ใช่ชนิดที่รู้จัก
 */
export interface FsColumnKind { range: string; lag: 0 | 1 | 2; bud: boolean }
export function parseFsColumnKind(kind: string): FsColumnKind | null {
  const k = kind.trim().toUpperCase().replace(/\s+/g, ' ');
  const bud = /\bBUD\b/.test(k);
  const lag: 0 | 1 | 2 = /\bLY ?2\b/.test(k) ? 2 : /\bLY\b/.test(k) ? 1 : 0;
  const m = k.match(/^PTD ?(\d{1,2})\b/);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= 12 ? { range: `P${n}`, lag, bud } : null; }
  if (k.startsWith('PTD')) return { range: 'PTD', lag, bud };
  if (k.startsWith('BAL') || k === 'BUD' || k.startsWith('BUD ')) return { range: 'YTD', lag, bud };
  return null;
}

/** หัวคอลัมน์มาตรฐานเมื่อผู้ใช้ไม่ได้ตั้งหัวเอง */
export function fsColumnHead(expr: string): string {
  const k = expr.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\bLY 2\b/, 'LY2');
  const m = k.match(/^PTD ?(\d{1,2})( LY2?)?( BUD)?$/);
  const lagText = (x?: string) => (!x ? '' : x.trim() === 'LY2' ? ' 2 ปีก่อน' : ' ปีที่แล้ว');
  if (m) return `${m[3] ? 'งบประมาณ' : ''}งวดที่ ${Number(m[1])}${lagText(m[2])}`;
  return ({ BAL: 'ยอดสะสม', PTD: 'ประจำงวด', 'BAL LY': 'ปีที่แล้ว', 'PTD LY': 'งวดเดียวกันปีที่แล้ว', 'BAL LY2': '2 ปีก่อน', 'PTD LY2': 'งวดเดียวกัน 2 ปีก่อน', BUD: 'งบประมาณสะสม', 'PTD BUD': 'งบประมาณงวดนี้' } as Record<string, string>)[k] ?? expr;
}

/** ตัวเลือกชนิดคอลัมน์สำหรับหน้าแก้แบบงบ */
export const FS_COLUMN_KINDS = ['BAL', 'PTD', 'BAL LY', 'PTD LY', 'BAL LY2', 'PTD LY2', 'BUD', 'PTD BUD'] as const;

const FORMULA_RE = /[()*/]|C\d+/i;
export const isFormulaColumn = (expr: string) => FORMULA_RE.test(expr) && /C\d+/i.test(expr);

/** คำนวณสูตรคอลัมน์ เช่น (C1-C2)*100/C2 — ยอมรับเฉพาะ C1..C18 ตัวเลข + - * / และวงเล็บ */
export function evalColumnFormula(expr: string, cols: (Decimal | null)[]): Decimal | null {
  const tokens = expr.replace(/\s+/g, '').match(/C\d+|\d+(?:\.\d+)?|[-+*/()]/gi);
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary(): Decimal | null {
    const t = next();
    if (t === undefined) throw new Error('eof');
    if (t === '(') { const v = sumExpr(); if (next() !== ')') throw new Error(')'); return v; }
    if (t === '-') { const v = primary(); return v === null ? null : v.neg(); }
    if (/^C\d+$/i.test(t)) { const v = cols[Number(t.slice(1)) - 1]; return v ?? null; }
    return new Decimal(t);
  }
  function product(): Decimal | null {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next(); const r = primary();
      if (v === null || r === null) { v = null; continue; }
      if (op === '/') { if (r.isZero()) return null; v = v.div(r); } else v = v.times(r);
    }
    return v;
  }
  function sumExpr(): Decimal | null {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = next(); const r = product();
      v = v === null || r === null ? null : op === '+' ? v.plus(r) : v.minus(r);
    }
    return v;
  }
  try {
    const v = sumExpr();
    return i === tokens.length ? v : null;
  } catch { return null; }
}

export function runFsLayout(lines: FsLine[], columns: FsColumn[], provider: FsValueProvider): { rows: FsRow[]; missingAccounts: string[] } {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  const dataCols = columns.map((c, i) => ({ c, i, formula: isFormulaColumn(c.expr) }));
  const vars = columns.map(() => Object.fromEntries(FS_VARS.map((v) => [v, ZERO])) as Record<FsVar, Decimal>);
  const rows: FsRow[] = [];
  const missing = new Set<string>();
  for (const l of sorted) {
    const dt = (l.data_type || '').trim().toUpperCase();
    const text = l.description_th ?? '';
    const textEn = l.description_en ?? '';
    const pc = (l.print_condition || '').trim().toUpperCase();
    if (dt === 'TXT') {
      if (pc !== 'N') rows.push({ kind: 'text', text, textEn, center: pc === 'C', line_no: l.line_no });
      continue;
    }
    if (dt === '---' || dt === '===') {
      if (pc !== 'N') rows.push({ kind: 'rule', double: dt === '===', line_no: l.line_no });
      continue;
    }
    if (!['A/C', 'BEG', 'INV', 'VAR'].includes(dt)) continue;
    const src = (l.source || '').trim();
    const values: (Decimal | null)[] = dataCols.map(({ c, i, formula }) => {
      if (formula) return null; // คำนวณหลังได้ค่าคอลัมน์อื่นครบ
      let v: Decimal | null;
      if (dt === 'VAR') v = vars[i]![src.toUpperCase() as FsVar] ?? ZERO;
      else {
        if (!provider.accountExists(src)) { missing.add(src); v = ZERO; }
        else v = provider.value(c.expr.trim().toUpperCase(), src, dt as 'A/C' | 'BEG' | 'INV', l.department_code || c.department_code);
        if (v !== null) {
          const f = (l.sign_filter || '').trim();
          if (f === '+' && v.isNegative()) v = ZERO;
          if (f === '-') v = v.isNegative() ? v.neg() : ZERO;
        }
      }
      return v;
    });
    // สะสมเข้าตัวแปร (ทำหลังอ่านค่า เพื่อให้ VAR แสดงค่าก่อนล้าง)
    dataCols.forEach(({ i, formula }) => {
      if (formula) return;
      const v = values[i] ?? ZERO;
      for (const x of FS_VARS) {
        const op = (l.accumulate?.[x] || '').trim();
        const cur = vars[i]![x];
        if (op === '+') vars[i]![x] = cur.plus(v);
        else if (op === '-') vars[i]![x] = cur.minus(v);
        else if (op === '0') vars[i]![x] = ZERO;
        else if (op === '/') vars[i]![x] = v.isZero() ? ZERO : cur.div(v);
      }
    });
    dataCols.forEach(({ c, i, formula }) => { if (formula) values[i] = evalColumnFormula(c.expr, values); });
    if (pc === 'N') continue;
    if (pc === 'Z' && values.every((v) => v === null || v.abs().lt('0.005'))) continue;
    rows.push({
      kind: 'value', text, textEn, line_no: l.line_no,
      values: values.map((v, i) => (v === null ? null : dataCols[i]!.formula ? v.toFixed(2) : v.toFixed(2))),
      account: dt === 'VAR' ? undefined : src, isTotal: dt === 'VAR',
    });
  }
  return { rows, missingAccounts: [...missing] };
}

/** แปลงหัวรายงาน Express เช่น "\NAME" "\END_PRD" */
export function expandHeader(text: string, ctx: { companyName: string; endDateText: string; startDateText?: string }): string {
  return text
    .replace(/ /g, ' ')
    .replace(/\\NAME/gi, ctx.companyName)
    .replace(/\\END_PRD/gi, ctx.endDateText)
    .replace(/\\BEG_PRD/gi, ctx.startDateText ?? '');
}

export { d };
