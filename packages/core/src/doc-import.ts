/**
 * นำเข้าเอกสารอื่นที่ลงบัญชีจาก Excel (HANDOFF 171 — เจ้าของ 21/11/2569 "ทุกเอกสารที่จะคีย์ ขอมีอ่านบิลด้วย Ai และ นำเข้า Excel")
 * รับชำระหนี้ RE / จ่ายชำระหนี้ PS · เอกสารธนาคาร BD BW BT BU BV · เอกสารคลัง OU RL JU CA · จ่ายเงินสดย่อย DP
 * กติกาเดียวกับนำเข้าขาย/ซื้อ (HANDOFF 169/170): หัวคอลัมน์ต้องมี * · แผ่นคำอธิบาย · แถวที่เลขที่อ้างอิงเดียวกันรวมเป็นเอกสารเดียว
 * (แถวต่อมาเว้นช่องหัวเอกสารได้ · ค่าไม่ว่างที่ต่างจากแถวแรก = ผิด) · ตรวจก่อนไม่บันทึก · บันทึกทั้งแฟ้มหรือไม่บันทึกเลย (server)
 * ส่วนนี้อ่านตารางเป็นเอกสาร (วันที่ → ISO · ตัวเลข → ข้อความทศนิยม) · การหารหัสและบันทึกอยู่ที่ server (doc-import.ts)
 */
import type { YearSystem } from './date.js';
import { BANK_KINDS, SETTLE_KINDS, STOCK_KINDS } from './doc-calc.js';
import { findHeader, headConflicts, importDate, importDocNoError, importNumber, MAX_IMPORT_DOCS, MAX_IMPORT_ROWS, type ImportIssue, type ImportNeed } from './trade-import.js';

export type DocImportFormat = 'text' | 'date' | 'number';
export interface DocImportCol {
  key: string; th: string; aliases: string[]; need: ImportNeed; when?: string; dflt?: string; hint: string; example: [string, string];
  /** ช่องของหัวเอกสาร (ใส่แถวแรกของเอกสารพอ) · ไม่ใช่ = ช่องของบรรทัด */
  head?: boolean; format?: DocImportFormat;
  /** ต้องมีคอลัมน์นี้ในแฟ้ม (หรือคอลัมน์ alt) */
  required?: boolean; alt?: string;
}
export type DocImportGroup = 'settle' | 'bank' | 'stock' | 'petty';
export interface DocImportKind {
  path: string; cls: string; label: string; menu: string; route: string; group: DocImportGroup; module: 'AR' | 'AP' | 'BK' | 'IC' | 'GL';
  /** หนึ่งแถวคืออะไร (แผ่นคำอธิบาย) */
  line: string; columns: DocImportCol[];
  /** มีบรรทัด (หลายแถวรวมเป็นเอกสารเดียว) — ไม่มี = หนึ่งแถว = หนึ่งเอกสาร */
  lines: boolean;
  /** แผ่นรับ/จ่ายชำระ (แบ่งหลายวิธี — HANDOFF 172) */
  payments?: boolean;
}

const REF: DocImportCol = { key: 'ref', th: 'เลขที่อ้างอิง', aliases: ['เลขที่', 'อ้างอิง', 'ref'], required: true, alt: 'doc_no', need: 'cond', when: 'ไม่ใส่เลขที่เอกสาร', head: true,
  hint: 'แถวที่เลขเดียวกันรวมเป็นเอกสารเดียว · เก็บในช่องอ้างอิงของเอกสาร (ไม่เกิน 30 ตัว) และใช้กันนำเข้าซ้ำ · ว่างได้ถ้าใส่ "เลขที่เอกสาร"', example: ['IMP-0001', 'IMP-0001'] };
const DOC_NO = (cls: string): DocImportCol => ({ key: 'doc_no', th: 'เลขที่เอกสาร', aliases: ['docno', 'doc no', 'document no'], need: 'opt', dflt: 'ค่าเริ่มต้น = ออกเลขอัตโนมัติ', head: true,
  hint: `ใส่เลขเอง: ต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสารที่เลือก (เช่น ${cls}…) ไม่เกิน 30 ตัว ไม่มีช่องว่าง ไม่ซ้ำกับเอกสารใดในบริษัท`, example: ['', ''] });
const DATE: DocImportCol = { key: 'date', th: 'วันที่', aliases: ['วันที่เอกสาร', 'date'], required: true, need: 'req', head: true, format: 'date', hint: 'วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ. ตามบริษัท) หรือช่องวันที่ของ Excel', example: ['15/10/2569', '15/10/2569'] };
const DEPT: DocImportCol = { key: 'department', th: 'แผนก', aliases: ['รหัสแผนก', 'department'], need: 'opt', dflt: 'ค่าเริ่มต้น = ตามประเภทเอกสาร', head: true, hint: 'รหัสหรือชื่อแผนก', example: ['', ''] };
const JOB: DocImportCol = { key: 'project', th: 'Job/โครงการ', aliases: ['Job', 'โครงการ', 'รหัส Job', 'project'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่ระบุ', head: true, hint: 'รหัสหรือชื่อ Job', example: ['', ''] };
const REMARK: DocImportCol = { key: 'remark', th: 'หมายเหตุ', aliases: ['remark', 'note', 'คำอธิบาย'], need: 'opt', head: true, hint: 'หมายเหตุของเอกสาร', example: ['นำเข้าจาก Excel', ''] };
const PAY_METHOD: DocImportCol = { key: 'pay_method', th: 'วิธีชำระ', aliases: ['วิธีรับชำระ', 'วิธีจ่ายชำระ', 'ชำระโดย', 'วิธีชำระเงิน'], need: 'opt', dflt: 'ค่าเริ่มต้น = เงินสดทั้งจำนวน', head: true,
  hint: 'รหัสหรือชื่อวิธีรับ/จ่ายชำระ — ใช้ยอดทั้งเอกสาร · แบ่งหลายวิธีใช้แผ่นรับ/จ่ายชำระ (ใส่เฉพาะวิธีที่ไม่ใช่เงินสด ส่วนที่เหลือ = เงินสด)', example: ['', ''] };
const PAY_REF: DocImportCol = { key: 'pay_ref', th: 'เลขที่อ้างอิง/เช็ค', aliases: ['เลขที่เช็ค', 'เลขที่โอน', 'อ้างอิงการชำระ'], need: 'cond', when: 'วิธีชำระเป็นเช็ค', head: true, hint: 'เลขที่เช็ค หรือเลขที่อ้างอิงการโอน', example: ['', ''] };
const party = (w: string): DocImportCol => ({ key: 'party', th: `รหัส${w}`, aliases: ['รหัสคู่ค้า', w, 'คู่ค้า', 'ชื่อ' + w, 'เลขผู้เสียภาษี'], required: true, need: 'req', head: true,
  hint: `รหัส ชื่อ หรือเลขผู้เสียภาษีของ${w}ที่มีในโปรแกรม (ไม่เพิ่มให้ — ต้องมีบิลค้างอยู่แล้ว)`, example: [w === 'ลูกค้า' ? 'C001' : 'S001', w === 'ลูกค้า' ? 'C001' : 'S001'] });

const settleCols = (cls: 'RE' | 'PS'): DocImportCol[] => {
  const recv = cls === 'RE', w = recv ? 'ลูกค้า' : 'ผู้จำหน่าย';
  return [REF, DOC_NO(cls), DATE, party(w), DEPT, REMARK, PAY_METHOD, PAY_REF,
    { key: 'wht_amount', th: recv ? 'ภาษีถูกหัก ณ ที่จ่าย' : 'ภาษีหัก ณ ที่จ่าย', aliases: ['หัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย', 'ภาษีถูกหัก ณ ที่จ่าย', 'wht'], need: 'opt', dflt: 'ค่าเริ่มต้น = ไม่หัก', head: true, format: 'number',
      hint: recv ? 'ยอดที่ลูกค้าหักไว้ (ต่อเอกสาร — ใส่แถวใดแถวหนึ่ง)' : 'ยอดภาษีที่หักไว้ (ต่อเอกสาร) · ว่าง + ใส่อัตรา = คำนวณจากยอดก่อน VAT ของบิล', example: ['', ''] },
    ...(recv ? [] : [
      { key: 'wht_rate', th: 'อัตราหัก ณ ที่จ่าย', aliases: ['อัตราภาษีหัก ณ ที่จ่าย', 'หัก ณ ที่จ่าย %'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = ไม่หัก', head: true, format: 'number' as const, hint: 'ร้อยละ เช่น 3 — ฐาน = ยอดชำระก่อน VAT', example: ['', ''] as [string, string] },
      { key: 'wht_income', th: 'ประเภทเงินได้', aliases: ['ประเภทเงินได้ที่จ่าย', 'เงินได้'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = ตามอัตรา/ผู้จำหน่าย', head: true, hint: 'เช่น ค่าบริการ ค่าขนส่ง ค่าเช่า', example: ['', ''] as [string, string] },
      { key: 'wht_form', th: 'แบบ ภ.ง.ด.', aliases: ['ภ.ง.ด.', 'ภงด'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = ตามผู้จำหน่าย (นิติบุคคล = 53)', head: true, hint: '3 หรือ 53', example: ['', ''] as [string, string] },
    ]),
    { key: 'bill', th: 'เลขที่บิลที่ตัด', aliases: ['เลขที่บิล', 'เลขที่ใบกำกับ', 'บิลที่ชำระ', 'เลขที่ใบแจ้งหนี้', 'invoice'], required: true, need: 'req',
      hint: recv ? 'เลขที่ขายเงินเชื่อ/ใบเพิ่มหนี้/ใบลดหนี้ที่ค้างของลูกค้ารายนี้ (หนึ่งแถว = หนึ่งบิล · ใบลดหนี้หักจากยอดรับ)' : 'เลขที่ซื้อเงินเชื่อ/ใบเพิ่มหนี้/ใบลดหนี้ที่ค้าง (เลขที่เอกสารในโปรแกรม หรือเลขที่ใบกำกับของผู้จำหน่าย) — หนึ่งแถว = หนึ่งบิล',
      example: [recv ? 'IV6911-0001' : 'RR6911-0001', recv ? 'IV6911-0002' : 'RR6911-0002'] },
    { key: 'amount', th: 'ยอดชำระ', aliases: ['จำนวนเงิน', 'ยอดเงิน', 'ยอดที่ตัด', 'amount'], need: 'opt', dflt: 'ค่าเริ่มต้น = ยอดคงค้างทั้งหมดของบิล', format: 'number', hint: 'ยอดที่ตัดบิลนี้ (ไม่เกินยอดคงค้าง · มากกว่า 0)', example: ['', '500'] },
  ];
};
const BANK_HINT: Record<string, string> = { BD: 'ฝากเงินสดเข้าบัญชี', BW: 'ถอนเงินสดจากบัญชี', BT: 'โอนเงินระหว่างบัญชีของกิจการ', BU: 'ดอกเบี้ยรับ/รายได้ที่ธนาคารจ่ายเข้าบัญชี', BV: 'ค่าธรรมเนียม/ดอกเบี้ยจ่ายที่ธนาคารหัก' };
const bankCols = (cls: string): DocImportCol[] => [REF, DOC_NO(cls), DATE,
  { key: 'bank', th: cls === 'BT' ? 'บัญชีที่โอนออก' : 'บัญชีเงินฝาก', aliases: ['บัญชีเงินฝาก', 'บัญชีธนาคาร', 'รหัสบัญชีเงินฝาก', 'เลขที่บัญชีธนาคาร', 'บัญชีที่โอนออก', 'bank'], required: true, need: 'req', head: true, hint: 'รหัส ชื่อ หรือเลขที่บัญชีของบัญชีเงินฝาก (เริ่มระบบ › บัญชีเงินฝาก)', example: ['B001', 'B001'] },
  ...(cls === 'BT' ? [{ key: 'to_bank', th: 'บัญชีที่โอนเข้า', aliases: ['โอนเข้า', 'บัญชีปลายทาง'], required: true, need: 'req' as const, head: true, hint: 'รหัส ชื่อ หรือเลขที่บัญชีปลายทาง (ต่างจากบัญชีที่โอนออก)', example: ['B002', 'B002'] as [string, string] }] : []),
  { key: 'amount', th: cls === 'BU' ? 'ดอกเบี้ยรับ' : 'จำนวนเงิน', aliases: ['จำนวนเงิน', 'ยอดเงิน', 'ดอกเบี้ยรับ', 'amount'], required: true, need: 'req', head: true, format: 'number', hint: `${BANK_HINT[cls]} · มากกว่า 0`, example: ['10000', '2500'] },
  ...(cls === 'BT' ? [{ key: 'fee', th: 'ค่าธรรมเนียม', aliases: ['ค่าธรรมเนียมโอน'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = 0', head: true, format: 'number' as const, hint: 'ค่าธรรมเนียมการโอน (หักจากบัญชีที่โอนออก)', example: ['', ''] as [string, string] }] : []),
  ...(cls === 'BU' ? [{ key: 'wht', th: 'ภาษีที่ธนาคารหัก', aliases: ['ภาษีหัก ณ ที่จ่าย', 'ภาษีถูกหัก'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = 0', head: true, format: 'number' as const, hint: 'ภาษีหัก ณ ที่จ่ายของดอกเบี้ย (น้อยกว่าดอกเบี้ยรับ)', example: ['', ''] as [string, string] }] : []),
  DEPT, REMARK];
const stockCols = (cls: string): DocImportCol[] => [REF, DOC_NO(cls), DATE,
  { key: 'warehouse', th: cls === 'RL' ? 'คลังต้นทาง' : 'คลัง', aliases: ['คลัง', 'คลังสินค้า', 'รหัสคลัง', 'คลังต้นทาง', 'warehouse'], need: cls === 'RL' ? 'req' : 'opt', required: cls === 'RL', dflt: cls === 'RL' ? undefined : 'ค่าเริ่มต้น = คลังตามประเภทเอกสาร/สินค้า', head: true, hint: 'รหัสหรือชื่อคลัง', example: ['', ''] },
  ...(cls === 'RL' ? [{ key: 'to_warehouse', th: 'คลังปลายทาง', aliases: ['โอนเข้าคลัง', 'คลังรับ'], required: true, need: 'req' as const, head: true, hint: 'รหัสหรือชื่อคลังปลายทาง (ต่างจากคลังต้นทาง)', example: ['WH2', 'WH2'] as [string, string] }] : []),
  DEPT, JOB, REMARK,
  { key: 'item', th: 'รหัสสินค้า', aliases: ['สินค้า', 'รหัส', 'item'], required: true, need: 'req', hint: 'รหัสหรือชื่อสินค้าที่มีสต๊อก (ไม่เพิ่มให้)', example: ['P0001', 'P0002'] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description'], need: 'opt', dflt: 'ค่าเริ่มต้น = ชื่อสินค้า', hint: 'คำอธิบายบรรทัด', example: ['', ''] },
  ...(cls === 'CA' ? [
    { key: 'amount', th: 'จำนวนเงินที่เพิ่ม/ลด', aliases: ['จำนวนเงิน', 'มูลค่า', 'amount'], required: true, need: 'req' as const, format: 'number' as const, hint: 'มูลค่าที่เพิ่ม (+) หรือลด (−) ต้นทุนสินค้า · สินค้าคิดต้นทุน FIFO ต้องเลือกล็อตที่หน้าจอ', example: ['500', '-200'] as [string, string] },
  ] : [
    { key: 'qty', th: 'จำนวน', aliases: ['qty'], required: true, need: 'req' as const, format: 'number' as const, hint: cls === 'JU' ? 'บวก = ปรับเพิ่ม · ลบ = ปรับลด (หน่วยตามคอลัมน์หน่วย)' : 'มากกว่า 0', example: ['5', cls === 'JU' ? '-2' : '3'] as [string, string] },
    { key: 'unit', th: 'หน่วย', aliases: ['หน่วยนับ', 'unit'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = หน่วยย่อยของสินค้า', hint: 'หน่วยย่อย หน่วยขาย หรือหน่วยซื้อของสินค้านั้น', example: ['', ''] as [string, string] },
  ]),
  ...(cls === 'JU' ? [{ key: 'unit_cost', th: 'ทุนต่อหน่วย', aliases: ['ต้นทุนต่อหน่วย', 'ราคาทุน'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = ต้นทุนเฉลี่ย/ราคาทุนมาตรฐาน', format: 'number' as const, hint: 'ใช้กับการปรับเพิ่ม', example: ['', ''] as [string, string] }] : []),
  ...(cls === 'OU' ? [{ key: 'line_job', th: 'Job รายบรรทัด', aliases: ['Job บรรทัด'], need: 'opt' as const, dflt: 'ค่าเริ่มต้น = Job ของหัวเอกสาร', hint: 'รหัสหรือชื่อ Job ที่เบิกใช้', example: ['', ''] as [string, string] }] : []),
];
const pettyCols: DocImportCol[] = [REF, DOC_NO('DP'), DATE, REMARK,
  { key: 'account', th: 'รหัสบัญชี', aliases: ['เลขที่บัญชี', 'บัญชี', 'account'], required: true, need: 'req', hint: 'เลขที่บัญชีหรือชื่อบัญชีค่าใช้จ่ายในผังบัญชี (ไม่ใช่บัญชีคุม)', example: ['5300-01', '5300-02'] },
  { key: 'description', th: 'รายละเอียด', aliases: ['description'], need: 'opt', dflt: 'ค่าเริ่มต้น = ว่าง', hint: 'รายการที่จ่าย', example: ['ค่าน้ำมันรถ', 'ค่าไปรษณีย์'] },
  { key: 'amount', th: 'จำนวนเงิน', aliases: ['ยอดเงิน', 'amount'], required: true, need: 'req', format: 'number', hint: 'มากกว่า 0', example: ['500', '120'] },
  { ...DEPT, head: false, hint: 'รหัสหรือชื่อแผนกของบรรทัด' }, { ...JOB, head: false, hint: 'รหัสหรือชื่อ Job ของบรรทัด' }];

export const DOC_IMPORT_KINDS: DocImportKind[] = [
  ...SETTLE_KINDS.map((k): DocImportKind => ({ path: k.path, cls: k.cls, label: k.label, menu: k.menu, route: k.route, group: 'settle', module: k.module, lines: true, payments: true,
    line: 'บิลที่ตัดชำระหนึ่งใบ', columns: settleCols(k.cls) })),
  ...BANK_KINDS.map((k): DocImportKind => ({ path: k.path, cls: k.cls, label: k.label, menu: 'FI.BK.TX', route: k.route, group: 'bank', module: 'BK', lines: false, line: 'เอกสารหนึ่งฉบับ', columns: bankCols(k.cls) })),
  ...STOCK_KINDS.map((k): DocImportKind => ({ path: k.path, cls: k.cls, label: k.label, menu: 'IC.TRN', route: k.route, group: 'stock', module: 'IC', lines: true, line: 'สินค้าหนึ่งบรรทัด', columns: stockCols(k.cls) })),
  { path: 'petty-payments', cls: 'DP', label: 'บันทึกการจ่ายเงินสดย่อย', menu: 'GL.PC', route: '/fi/petty-cash', group: 'petty', module: 'GL', lines: true, line: 'รายการจ่ายหนึ่งบรรทัด', columns: pettyCols },
];
export const docImportKindOf = (path: string) => DOC_IMPORT_KINDS.find((k) => k.path === path) ?? null;
export const docImportPathOf = (cls: string) => DOC_IMPORT_KINDS.find((k) => k.cls === cls)?.path ?? null;

export interface DocImportDoc { ref: string; row: number; doc_no: string | null; head: Record<string, string>; lines: Array<{ row: number; v: Record<string, string> }> }
/**
 * ตาราง → เอกสาร: หาหัวตาราง · รวมแถวตามเลขที่อ้างอิง (หรือเลขที่เอกสาร) · ช่องหัวเอกสารแถวต่อมาเว้นได้ (ต่างจากแถวแรก = ผิด)
 * ช่องที่ต้องมี (need = req) ว่าง = ผิด · วันที่/ตัวเลขผิดรูปแบบ = ผิด บอกแถวและคอลัมน์
 */
export function mapDocImport(rows: string[][], ys: YearSystem, K: DocImportKind): { docs: DocImportDoc[]; errors: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const h = findHeader(rows, K.columns as Array<{ key: string; th: string; aliases: readonly string[]; required?: boolean; alt?: string }>);
  if ('error' in h) return { docs: [], errors: [h.error] };
  const { headAt, cols } = h;
  const docs = new Map<string, DocImportDoc>();
  const thOf = (k: string) => K.columns.find((c) => c.key === k)?.th ?? k;
  let count = 0;
  for (let r = headAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (!row.some((x) => String(x ?? '').trim())) continue;
    const no = r + 1;
    if (++count > MAX_IMPORT_ROWS) { errors.push({ row: no, message: `แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว — แบ่งเป็นหลายแฟ้ม` }); break; }
    const cell = (k: string) => { const i = cols.get(k); return i === undefined ? '' : String(row[i] ?? '').trim(); };
    const bad = (m: string) => errors.push({ row: no, message: m });
    const n0 = errors.length;
    const docNo = cell('doc_no'), ref = cell('ref') || docNo;
    if (!ref) { bad(`ไม่มีเลขที่อ้างอิง (คอลัมน์ "เลขที่อ้างอิง"${cols.has('doc_no') ? ' หรือ "เลขที่เอกสาร"' : ''} ต้องมีทุกแถว)`); continue; }
    if (ref.length > 30) bad(`เลขที่อ้างอิง "${ref}" ยาวเกิน 30 ตัว`);
    const docNoBad = importDocNoError(docNo);
    if (docNoBad) bad(docNoBad);
    const first = docs.get(ref);
    if (first && !K.lines) { bad(`เลขที่อ้างอิง ${ref} ซ้ำกับแถว ${first.row} — ${K.label}หนึ่งแถวเป็นหนึ่งเอกสาร`); continue; }
    const head: Record<string, string> = {}, line: Record<string, string> = {};
    for (const c of K.columns) {
      if (c.key === 'ref') continue;
      let v = cell(c.key);
      // แถวต่อมาของเอกสารเดียวกัน: ช่องหัวเอกสารว่าง = ตามแถวแรก
      if (c.head && !v && first) continue;
      if (v && c.format === 'date') { const x = importDate(v, ys); if (!x) { bad(`${c.th} "${v}" ไม่ถูกต้อง — ใช้ วว/ดด/ปปปป`); continue; } v = x; }
      if (v && c.format === 'number') { const x = importNumber(v); if (x === null) { bad(`${c.th} "${v}" ไม่ใช่ตัวเลข`); continue; } v = x; }
      if (!v && c.need === 'req') { bad(`ไม่มี${c.th} (คอลัมน์ "${c.th}" ต้องมี)`); continue; }
      if (v) (c.head ? head : line)[c.key] = v;
    }
    if (errors.length > n0) continue;
    if (!first) {
      if (docs.size >= MAX_IMPORT_DOCS) { bad(`แฟ้มเดียวนำเข้าได้ไม่เกิน ${MAX_IMPORT_DOCS} เอกสาร — แบ่งเป็นหลายแฟ้ม`); break; }
      docs.set(ref, { ref, row: no, doc_no: head.doc_no ?? null, head, lines: K.lines ? [{ row: no, v: line }] : [] });
      continue;
    }
    const before = errors.length;
    headConflicts(ref, { row: first.row, ...first.head }, head, [], thOf, bad);
    if (errors.length > before) continue;
    for (const [k, v] of Object.entries(head)) first.head[k] ??= v;
    first.doc_no ??= head.doc_no ?? null;
    first.lines.push({ row: no, v: line });
  }
  if (!docs.size && !errors.length) errors.push({ row: headAt + 2, message: 'ไม่มีรายการใต้หัวตาราง' });
  return { docs: [...docs.values()], errors };
}
