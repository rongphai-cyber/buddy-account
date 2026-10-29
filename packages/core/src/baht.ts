import { d, type MoneyInput } from './money.js';

const DIGIT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านเลขไม่เกิน 6 หลัก (ไม่มีศูนย์นำหน้า) — "เอ็ด" เมื่อหลักหน่วยเป็น 1 และมีหลักอื่นนำหน้า (รวมกรณีต่อจาก "ล้าน") */
function six(s: string, hasLead: boolean): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const n = Number(s[i]);
    const pos = s.length - 1 - i;
    if (n === 0) continue;
    if (pos === 1) out += n === 1 ? 'สิบ' : n === 2 ? 'ยี่สิบ' : DIGIT[n]! + 'สิบ';
    else if (pos === 0 && n === 1 && (hasLead || s.length > 1)) out += 'เอ็ด';
    else out += DIGIT[n]! + POS[pos]!;
  }
  return out;
}

/** อ่านจำนวนเต็มบวก (สตริงตัวเลข) เป็นคำไทย แบ่งทีละ 6 หลักด้วย "ล้าน" */
function words(digits: string): string {
  const s = digits.replace(/^0+/, '');
  if (!s) return DIGIT[0]!;
  if (s.length <= 6) return six(s, false);
  const head = s.slice(0, -6), tail = s.slice(-6).replace(/^0+/, '');
  return words(head) + 'ล้าน' + (tail ? six(tail, true) : '');
}

/**
 * จำนวนเงินเป็นตัวอักษร แบบ BAHTTEXT — ใช้ในหนังสือรับรองการหักภาษี ณ ที่จ่าย ใบเสร็จ เช็ค
 * 100000 → หนึ่งแสนบาทถ้วน · 21.01 → ยี่สิบเอ็ดบาทหนึ่งสตางค์ · 0.50 → ห้าสิบสตางค์
 */
export function bahtText(value: MoneyInput): string {
  const v = d(value).toDecimalPlaces(2);
  if (v.isZero()) return 'ศูนย์บาทถ้วน';
  const [int, frac = '00'] = v.abs().toFixed(2).split('.');
  const baht = int !== '0' ? words(int!) + 'บาท' : '';
  const satang = frac !== '00' ? words(frac) + 'สตางค์' : 'ถ้วน';
  return (v.isNeg() ? 'ลบ' : '') + baht + satang;
}
