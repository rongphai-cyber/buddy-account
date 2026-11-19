/**
 * แบบอักษรของแผ่นเอกสาร (HANDOFF 152 · PRINT_FONTS ใน core)
 * IBM Plex Sans Thai และ Sarabun โหลดอยู่แล้ว (index.html) — แบบอักษรอื่นเพิ่มลิงก์ Google Fonts เมื่อมีแบบฟอร์มใช้
 * ลิงก์อยู่ใน head ของหน้า จึงถูกคัดลอกไปกรอบพิมพ์ด้วย (printFrame.tsx รอแบบอักษรที่แผ่นใช้โหลดครบก่อนสั่งพิมพ์)
 */
const PRELOADED: Record<string, string> = { 'IBM Plex Sans Thai': '', Sarabun: '600' };

export function ensurePrintFont(family: string): void {
  if (!family || typeof document === 'undefined') return;
  const id = 'pf-font-' + family.replace(/\W+/g, '-').toLowerCase();
  if (PRELOADED[family] === '' || document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + family.replace(/ /g, '+') + ':wght@' + (PRELOADED[family] ?? '400;600;700') + '&display=swap';
  document.head.appendChild(link);
}

/** font-family ของแผ่น: แบบอักษรที่เลือก แล้วตามด้วยแบบอักษรไทยสำรอง */
export const printFontStack = (family: string) => "'" + family + "', 'Sarabun', Tahoma, 'Leelawadee UI', sans-serif";
