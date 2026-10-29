import type { CSSProperties } from 'react';

/**
 * สีประจำสมุดรายวัน — ใช้ทั้งแถบในหน้ารายการ ปุ่มเพิ่ม และหัวฟอร์ม ให้รู้ชัดว่ากำลังบันทึกสมุดไหน
 * สมุดมาตรฐาน: JV ม่วง · PV (จ่าย) ส้มแดง · RV (รับ) เขียว · SV (ขาย) ฟ้า · UV (ซื้อ) เหลืองทอง · สมุดอื่นวนตามรหัส
 */
const BY_PREFIX: Record<string, string> = { JV: '#7a52c7', PV: '#d0573a', RV: '#2e9a5e', SV: '#2f7fc2', UV: '#b07d0b' };
const OTHERS = ['#c2477f', '#2a948e', '#5866c4', '#8a6d3b', '#3f7f3f', '#b5562e'];

export function bookColor(b: { code: string; prefix: string } | null | undefined): string | undefined {
  if (!b) return undefined;
  const p = BY_PREFIX[b.prefix?.toUpperCase()];
  if (p) return p;
  const n = [...(b.code + b.prefix)].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return OTHERS[n % OTHERS.length];
}

/** style ที่ตั้งตัวแปร CSS --book-c */
export const bookStyle = (c: string | undefined): CSSProperties | undefined => (c ? ({ ['--book-c' as string]: c } as CSSProperties) : undefined);
