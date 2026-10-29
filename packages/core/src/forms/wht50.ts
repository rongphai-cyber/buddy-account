/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ — แบบของกรมสรรพากร (docs/50ทวิ.pdf)
 * พิมพ์ทับภาพแบบฟอร์มจริง (apps/web/public/forms/wht50.png สร้างด้วย tools/forms/render_wht50.mjs)
 * ตำแหน่งทุกช่องมาจากช่องกรอก (AcroForm) ของไฟล์ต้นฉบับ หน่วย pt บนหน้า A4 595×842 วัดจากมุมบนซ้าย
 */
import { d, fmt, type MoneyInput } from '../money.js';
import { bahtText } from '../baht.js';
import { MONTH_TH, BE_OFFSET, parseIso } from '../date.js';

export const WHT50_PAGE = { w: 595, h: 842 } as const;

/** [x1, y1, x2, y2] ตามไฟล์ PDF (จุดกำเนิดมุมล่างซ้าย) */
type Rect = [number, number, number, number];
const F: Record<string, Rect> = {
  book_no: [519.4, 781.2, 559.4, 797.2], run_no: [519.3, 764.7, 560.0, 780.7],
  id1: [374.7, 744.0, 558.4, 758.7], tin1: [418.0, 727.7, 556.6, 741.7], name1: [53.9, 729.1, 316.3, 745.2], add1: [60.8, 705.7, 550.4, 721.6],
  id2: [375.3, 675.6, 557.6, 690.3], tin2: [419.3, 656.6, 558.0, 671.3], name2: [53.2, 657.6, 314.9, 671.1], add2: [59.2, 630.5, 549.6, 646.8],
  item: [77.0, 600.6, 138.8, 615.9],
  chk1: [209.3, 602.5, 222.0, 615.2], chk2: [288.0, 602.5, 300.7, 615.2], chk3: [394.7, 601.9, 407.3, 614.5], chk4: [471.3, 601.9, 484.0, 614.5],
  chk5: [209.3, 583.9, 222.0, 596.5], chk6: [287.3, 583.9, 300.0, 596.5], chk7: [394.7, 583.9, 407.3, 596.5],
  // ที่อยู่ผู้ถูกหัก: ช่องในไฟล์ต้นฉบับต่ำกว่าเส้นประ 3.5 pt (ทับคำแนะนำใต้เส้น) จึงยกขึ้น
  rate1: [162.2, 385.4, 203.2, 399.9], spec1: [146.7, 270.3, 314.7, 285.5], spec3: [96.0, 197.1, 324.7, 213.8],
  total_words: [184.6, 157.6, 557.5, 176.8],
  fund_gpf: [216.2, 141.1, 273.4, 156.4], fund_sso: [356.7, 141.2, 407.3, 156.5], fund_pvd: [484.0, 139.1, 546.1, 154.4],
  chk8: [82.5, 119.1, 94.0, 130.8], chk9: [177.3, 120.5, 188.2, 132.5], chk10: [282.3, 119.8, 294.3, 131.8], chk11: [393.7, 119.2, 405.7, 131.2], spec4: [468.0, 117.9, 557.6, 132.3],
  date_pay: [341.8, 72.1, 366.0, 87.3], month_pay: [363.6, 70.6, 428.4, 87.3], year_pay: [429.3, 72.3, 470.1, 86.7],
};
/** แนวตั้งของช่อง วัน เดือน ปี / จำนวนเงิน / ภาษี (y1, y2 ของแต่ละบรรทัด) — ช่องบาท/สตางค์แยกด้วยเส้นที่ x 474.9 และ 546.4 */
const ROWS = {
  '1': [533.1, 546.8], '2': [519.4, 533.5], '3': [504.0, 518.1], '4a': [490.0, 503.7],
  '4b1.1': [433.0, 446.7], '4b1.2': [418.5, 432.2], '4b1.3': [403.2, 416.9], '4b1.4': [387.8, 402.4],
  '4b2.1': [359.5, 373.2], '4b2.2': [330.2, 344.8], '4b2.3': [302.8, 316.6], '4b2.4': [287.2, 302.0], '4b2.5': [270.5, 286.8],
  '5': [216.3, 230.4], '6': [198.9, 213.0], total: [180.4, 195.5],
} as const;
const COL = { date: [327.3, 404.8], pay: [404.8, 474.9, 489.8], tax: [489.8, 546.4, 560.6] } as const;

export type Wht50Row = Exclude<keyof typeof ROWS, 'total'>;
/** ประเภทเงินได้ตามแบบ (ข้อ 1–6) */
export const WHT50_ROWS: Array<[Wht50Row, string]> = [
  ['1', '1. เงินเดือน ค่าจ้าง ฯลฯ ม.40 (1)'], ['2', '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ม.40 (2)'], ['3', '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ม.40 (3)'], ['4a', '4 (ก) ดอกเบี้ย ฯลฯ ม.40 (4)(ก)'],
  ['4b1.1', '4 (ข)(1.1) เงินปันผล เครดิตภาษี 30%'], ['4b1.2', '4 (ข)(1.2) เงินปันผล เครดิตภาษี 25%'], ['4b1.3', '4 (ข)(1.3) เงินปันผล เครดิตภาษี 20%'], ['4b1.4', '4 (ข)(1.4) เงินปันผล อัตราอื่น'],
  ['4b2.1', '4 (ข)(2.1) ปันผลจากกำไรที่ได้รับยกเว้น'], ['4b2.2', '4 (ข)(2.2) ปันผลที่ได้รับยกเว้นไม่ต้องนำมารวม'], ['4b2.3', '4 (ข)(2.3) กำไรส่วนที่หักผลขาดทุนยกมา'],
  ['4b2.4', '4 (ข)(2.4) กำไรตามวิธีส่วนได้เสีย'], ['4b2.5', '4 (ข)(2.5) อื่น ๆ'], ['5', '5. ค่าจ้างทำของ ค่าบริการ ค่าเช่า ค่าขนส่ง ค่าโฆษณา ฯลฯ (ม.3 เตรส)'], ['6', '6. อื่น ๆ (ระบุ)'],
];
/** แบบที่ยื่น (ลำดับช่องเลือก 1–7 บนแบบ) */
export const WHT50_FORMS = ['1ก', '1ก พิเศษ', '2', '3', '2ก', '3ก', '53'] as const;
export type Wht50Form = (typeof WHT50_FORMS)[number];

export interface Wht50Party { name: string; address?: string | null; tax_id?: string | null; branch_no?: string | null }
export interface Wht50Data {
  book_no?: string | null; run_no?: string | null; seq_no?: string | null;
  payer: Wht50Party; payee: Wht50Party;
  form: Wht50Form;
  lines: Array<{ row: Wht50Row; date: string; amount: MoneyInput; tax: MoneyInput }>;
  rate_4b14?: string | null; text_4b25?: string | null; text_6?: string | null;
  funds?: { gpf?: MoneyInput; sso?: MoneyInput; pvd?: MoneyInput };
  /** 1 หัก ณ ที่จ่าย · 2 ออกให้ตลอดไป · 3 ออกให้ครั้งเดียว · 4 อื่น ๆ */
  condition: '1' | '2' | '3' | '4'; condition_other?: string | null;
  issue_date: string;
  /** ทำเครื่องหมายที่ ฉบับที่ 1 หรือ 2 (ว่าง = ไม่ทำ) */
  copy?: 1 | 2 | null;
}
export interface Wht50Item { key: string; x: number; y: number; w: number; h: number; text: string; align: 'left' | 'center' | 'right'; size: number; bold?: boolean }

const box = (key: string, r: Rect, text: string, align: Wht50Item['align'] = 'left', size = 10): Wht50Item =>
  ({ key, x: r[0], y: WHT50_PAGE.h - r[3], w: r[2] - r[0], h: r[3] - r[1], text, align, size });
/** วันที่ dd/mm/ปปปป (พ.ศ. เสมอ ตามแบบของกรมสรรพากร) */
export const wht50Date = (iso: string) => { const p = parseIso(iso); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y + BE_OFFSET}`; };

/** ตัวเลขในช่องแบบ comb (เลข 13 หลักแยกกลุ่ม 1-4-5-2-1 บน 17 ช่อง / เลข 10 หลักแยก 1-4-4-1 บน 13 ช่อง) */
function comb(key: string, r: Rect, digits: string, groups: number[]): Wht50Item[] {
  const cells = groups.reduce((s, g) => s + g, 0) + groups.length - 1;
  const cw = (r[2] - r[0]) / cells;
  const out: Wht50Item[] = [];
  let cell = 0, k = 0;
  for (const g of groups) {
    for (let i = 0; i < g; i++, cell++, k++) out.push(box(`${key}.${k}`, [r[0] + cell * cw, r[1], r[0] + (cell + 1) * cw, r[3]], digits[k] ?? '', 'center', 11));
    cell++;   // ช่องขีดคั่นกลุ่ม
  }
  return out;
}
function taxIdItems(key: string, idRect: Rect, tinRect: Rect, raw: string | null | undefined): Wht50Item[] {
  const v = (raw ?? '').replace(/\D/g, '');
  if (v.length === 13) return comb(key, idRect, v, [1, 4, 5, 2, 1]);
  if (v.length === 10) return comb(key + '_tin', tinRect, v, [1, 4, 4, 1]);
  return [];
}
const partyName = (p: Wht50Party) => {
  const b = (p.branch_no ?? '').replace(/\D/g, '');
  if (!b || !p.tax_id) return p.name;
  return `${p.name} ${Number(b) === 0 ? '(สำนักงานใหญ่)' : `(สาขาที่ ${b.padStart(5, '0')})`}`;
};
/** จำนวนเงินแยกช่องบาท/สตางค์ ตามเส้นแบ่งบนแบบ */
function amount(key: string, col: readonly [number, number, number], y: readonly [number, number], v: MoneyInput, bold = false): Wht50Item[] {
  const [baht, satang] = d(v).toFixed(2).split('.');
  const top = WHT50_PAGE.h - y[1], h = y[1] - y[0];
  return [
    { key: key + '.baht', x: col[0], y: top, w: col[1] - col[0] - 2, h, text: fmt(baht, { places: 0 }), align: 'right', size: 10, bold },
    { key: key + '.satang', x: col[1], y: top, w: col[2] - col[1], h, text: satang!, align: 'center', size: 10, bold },
  ];
}

/** ตำแหน่งข้อความทั้งหมดที่ต้องพิมพ์ลงแบบ 50 ทวิ (ฟังก์ชันบริสุทธิ์ — หน้าจอพิมพ์และ PDF ใช้ร่วมกัน) */
export function wht50Layout(data: Wht50Data): { items: Wht50Item[]; total_amount: string; total_tax: string; total_words: string } {
  const items: Wht50Item[] = [];
  const push = (...x: Wht50Item[]) => items.push(...x.filter((i) => i.text !== ''));
  push(box('book_no', F.book_no!, data.book_no ?? '', 'left', 9), box('run_no', F.run_no!, data.run_no ?? '', 'left', 9));
  push(...taxIdItems('payer_id', F.id1!, F.tin1!, data.payer.tax_id), box('payer_name', F.name1!, partyName(data.payer)), box('payer_address', F.add1!, data.payer.address ?? '', 'left', 9.5));
  push(...taxIdItems('payee_id', F.id2!, F.tin2!, data.payee.tax_id), box('payee_name', F.name2!, partyName(data.payee)), box('payee_address', F.add2!, data.payee.address ?? '', 'left', 9.5));
  push(box('seq_no', F.item!, data.seq_no ?? '', 'center'));
  const fi = WHT50_FORMS.indexOf(data.form);
  if (fi >= 0) push(box('form', F[`chk${fi + 1}`]!, '✓', 'center', 12));

  // รวมบรรทัดประเภทเดียวกัน: วันที่ใช้วันล่าสุด
  const rows = new Map<Wht50Row, { date: string; amount: ReturnType<typeof d>; tax: ReturnType<typeof d> }>();
  for (const l of data.lines) {
    const cur = rows.get(l.row);
    rows.set(l.row, { date: !cur || l.date > cur.date ? l.date : cur.date, amount: (cur?.amount ?? d(0)).plus(d(l.amount)), tax: (cur?.tax ?? d(0)).plus(d(l.tax)) });
  }
  let ta = d(0), tt = d(0);
  for (const [row, v] of rows) {
    const y = ROWS[row];
    push(box(`date.${row}`, [COL.date[0], y[0], COL.date[1], y[1]], wht50Date(v.date), 'center'));
    push(...amount(`pay.${row}`, COL.pay, y, v.amount), ...amount(`tax.${row}`, COL.tax, y, v.tax));
    ta = ta.plus(v.amount); tt = tt.plus(v.tax);
  }
  if (data.rate_4b14) push(box('rate_4b14', F.rate1!, data.rate_4b14, 'center', 9));
  if (data.text_4b25) push(box('text_4b25', F.spec1!, data.text_4b25, 'left', 9));
  if (data.text_6) push(box('text_6', F.spec3!, data.text_6, 'left', 9));
  push(...amount('pay.total', COL.pay, ROWS.total, ta, true), ...amount('tax.total', COL.tax, ROWS.total, tt, true));
  const words = bahtText(tt);
  push({ ...box('total_words', F.total_words!, words, 'left', 12), bold: true });

  const fund = (k: string, r: Rect, v: MoneyInput) => { if (v !== undefined && v !== null && v !== '' && !d(v).isZero()) push(box(k, r, fmt(v), 'center', 9)); };
  fund('fund_gpf', F.fund_gpf!, data.funds?.gpf); fund('fund_sso', F.fund_sso!, data.funds?.sso); fund('fund_pvd', F.fund_pvd!, data.funds?.pvd);
  push(box('condition', F[`chk${7 + Number(data.condition)}`]!, '✓', 'center', 12));
  if (data.condition === '4' && data.condition_other) push(box('condition_other', F.spec4!, data.condition_other, 'left', 8.5));

  const p = parseIso(data.issue_date);
  push(box('issue_d', F.date_pay!, String(p.d), 'center'), box('issue_m', F.month_pay!, MONTH_TH[p.m - 1]!, 'center'), box('issue_y', F.year_pay!, String(p.y + BE_OFFSET), 'center'));
  // ฉบับที่ 1 / 2 อยู่บนสุดของแบบ (y ประมาณ 20 และ 36.5 pt)
  if (data.copy) push({ key: 'copy', x: 18, y: data.copy === 1 ? 13 : 29.5, w: 12, h: 14, text: '✓', align: 'center', size: 12, bold: true });
  return { items, total_amount: ta.toFixed(2), total_tax: tt.toFixed(2), total_words: words };
}

/**
 * แบบที่ยื่นจากรหัสแบบ ภ.ง.ด. ของผู้จำหน่าย (ตาราง 55: S03 = ภ.ง.ด.3, S53 = ภ.ง.ด.53)
 * ไม่ได้กำหนด → ดูจากเลขผู้เสียภาษี: ขึ้นต้น 0 = นิติบุคคล (ภ.ง.ด.53) อื่น ๆ = บุคคลธรรมดา (ภ.ง.ด.3)
 */
export function wht50FormOf(code: string | null | undefined, taxId?: string | null): Wht50Form {
  const c = (code ?? '').toUpperCase();
  if (/53/.test(c)) return '53';
  if (/3/.test(c)) return '3';
  const t = (taxId ?? '').replace(/\D/g, '');
  return t.length === 13 && t[0] !== '0' ? '3' : '53';
}
