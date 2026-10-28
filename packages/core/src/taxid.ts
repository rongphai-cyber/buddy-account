/** เลขประจำตัวผู้เสียภาษี / เลขบัตรประชาชน 13 หลัก */

export type TaxIdCheck =
  | { ok: true; kind: 'TAX13'; normalized: string }
  | { ok: true; kind: 'LEGACY10'; normalized: string; warning: string }
  | { ok: false; error: string };

export function taxIdCheckDigit(first12: string): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * (13 - i);
  return (11 - (s % 11)) % 10;
}

/**
 * ตรวจเลขผู้เสียภาษี
 * - 13 หลักต้องผ่าน check digit
 * - 10 หลัก (เลขเก่าก่อนปี 2556 ที่ยังพบในข้อมูล Express) รับได้แต่เตือน
 */
export function checkTaxId(input: string | null | undefined): TaxIdCheck {
  const v = (input ?? '').replace(/[\s-]/g, '');
  if (!v) return { ok: false, error: 'ยังไม่ได้ป้อนเลขประจำตัวผู้เสียภาษี' };
  if (!/^\d+$/.test(v)) return { ok: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลขเท่านั้น' };
  if (v.length === 13) {
    if (taxIdCheckDigit(v.slice(0, 12)) !== Number(v[12])) return { ok: false, error: 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (หลักตรวจสอบไม่ตรง)' };
    return { ok: true, kind: 'TAX13', normalized: v };
  }
  if (v.length === 10) return { ok: true, kind: 'LEGACY10', normalized: v, warning: 'เป็นเลขผู้เสียภาษีแบบเก่า 10 หลัก ควรเปลี่ยนเป็นเลข 13 หลัก' };
  return { ok: false, error: `เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก (ป้อนมา ${v.length} หลัก)` };
}

/** แสดงเลขแบบ 0-0000-00000-00-0 */
export function formatTaxId(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\D/g, '');
  if (s.length !== 13) return v ?? '';
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`;
}

/** สาขาตามกรมสรรพากร: 00000 = สำนักงานใหญ่ */
export function formatTaxBranch(no: string | null | undefined): string {
  if (!no) return '';
  if (/^0+$/.test(no)) return 'สำนักงานใหญ่';
  return `สาขาที่ ${no.padStart(5, '0')}`;
}
