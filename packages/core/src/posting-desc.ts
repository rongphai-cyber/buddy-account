/**
 * คำอธิบายบรรทัดของใบสำคัญที่ระบบลงบัญชีจากเอกสาร (เจ้าของ 17/11/2569: "สมุดรายวันมาจากระบบอื่น คำอธิบายไม่มีมาด้วย
 * ต้องมี format ที่จะมีคำอธิบายว่าคืออะไร เหมือนที่จะแสดงในบัญชีแยกประเภท")
 *
 * รูปแบบ: คำอธิบายหัวใบสำคัญ (ชนิดเอกสาร + คู่ค้า ตามแม่แบบของประเภทเอกสาร) ทุกบรรทัด
 *   + " · ป้ายบทบาท" เฉพาะบรรทัดประกอบ (ภาษีซื้อ/ขาย ภาษีหัก ณ ที่จ่าย เงินมัดจำ ส่วนลด ดอกเบี้ย ค่าธรรมเนียม ฯลฯ)
 *   + " · เช็คจ่าย/เช็ครับ เลขที่" สำหรับบรรทัดรับ/จ่ายด้วยเช็ค
 * บรรทัดหลัก (ค่าใช้จ่าย รายได้ ซื้อ ขาย ลูกหนี้ เจ้าหนี้ เงินสด เงินฝาก) ใช้คำอธิบายหัวอย่างเดียว
 * ใช้ทั้งตอนลงบัญชี (เก็บลง gl_journal_line.description) และตอนแสดงใบสำคัญเดิมที่บรรทัดยังว่าง (ไม่แก้ข้อมูลเดิม)
 */
import { d, type MoneyInput } from './money.js';

/** ป้ายของบรรทัดประกอบ — บทบาทที่ไม่อยู่ในนี้ = บรรทัดหลัก (ไม่มีป้าย) · WHT ดูด้านเดบิต/เครดิต */
export const POSTED_ROLE_LABEL: Record<string, string> = {
  INPUT_VAT: 'ภาษีซื้อ',
  INPUT_VAT_PENDING: 'ภาษีซื้อยังไม่ถึงกำหนด',
  OUTPUT_VAT: 'ภาษีขาย',
  OUTPUT_VAT_PENDING: 'ภาษีขายยังไม่ถึงกำหนด',
  WHT_PAYABLE: 'ภาษีหัก ณ ที่จ่าย',
  WHT_RECOVERABLE: 'ภาษีหัก ณ ที่จ่ายเรียกคืน',
  WHT_BORNE: 'ภาษีหัก ณ ที่จ่ายออกแทน',
  DEPOSIT_RECEIVED: 'เงินมัดจำรับ',
  DEPOSIT_PAID: 'เงินมัดจำจ่าย',
  CASH_DISCOUNT: 'ส่วนลดเงินสด',
  INTEREST: 'ดอกเบี้ย',
  PLATFORM_FEE: 'ค่าบริการที่ถูกหัก',
  BANK_CHARGE: 'ค่าธรรมเนียมธนาคาร',
  FX: 'กำไร(ขาดทุน)จากอัตราแลกเปลี่ยน',
  FX_GAIN_LOSS: 'กำไร(ขาดทุน)จากอัตราแลกเปลี่ยน',
  COGS: 'ต้นทุนขาย',
  OPENING_BALANCE: 'บัญชีพักยอดยกมา',
};

export function postedLineDesc(head: string | null | undefined, l: { role: string | null | undefined; debit: MoneyInput; detail?: { text: string; alone: boolean } | null }, chequeNo?: string | null): string | null {
  // รายละเอียดของบรรทัดเอกสาร (เจ้าของ 17/11/2569 "คำอธิบายค่าใช้จ่ายเงินสดย่อย … แสดงในสมุดรายวันและแยกประเภท อันเดียวกัน")
  const det = (l.detail?.text ?? '').trim();
  if (det && l.detail!.alone) return det.slice(0, 200);
  if (det && det !== (head ?? '').trim()) head = `${(head ?? '').trim()}${head ? ' · ' : ''}${det}`;
  const dr = d(l.debit || 0).gt(0);
  const label = l.role === 'WHT' ? (dr ? 'ภาษีถูกหัก ณ ที่จ่าย' : 'ภาษีหัก ณ ที่จ่าย')
    : chequeNo ? `${dr ? 'เช็ครับ' : 'เช็คจ่าย'} ${chequeNo}`
    : (l.role && POSTED_ROLE_LABEL[l.role]) || '';
  const h = (head ?? '').trim();
  const s = h && label ? `${h} · ${label}` : h || label;
  if (!s) return null;
  // ช่องคำอธิบายบรรทัดยาว 200 ตัว — ตัดคำอธิบายหัวให้ป้ายท้ายยังอยู่ครบ
  return s.length <= 200 ? s : `${h.slice(0, Math.max(0, 200 - label.length - 4))}… · ${label}`.slice(0, 200);
}
