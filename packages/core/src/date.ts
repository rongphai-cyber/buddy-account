/**
 * วันที่: ฐานข้อมูลเก็บ ค.ศ. รูปแบบ ISO (yyyy-mm-dd) เสมอ
 * หน้าจอแสดง/รับเป็น พ.ศ. หรือ ค.ศ. ตามค่าบริษัท year_system ('B' = พ.ศ., 'C' = ค.ศ.)
 */
export type YearSystem = 'B' | 'C';
export const BE_OFFSET = 543;

export const MONTH_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const MONTH_TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isoDate(y: number, m: number, day: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
}

export function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

export function isValidYmd(y: number, m: number, day: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(day)) return false;
  if (m < 1 || m > 12 || day < 1) return false;
  return day <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** แสดงวันที่ dd/mm/yyyy ตามระบบปีของบริษัท */
export function formatDate(iso: string | null | undefined, ys: YearSystem = 'B'): string {
  if (!iso) return '';
  const { y, m, d } = parseIso(iso);
  return `${pad(d)}/${pad(m)}/${ys === 'B' ? y + BE_OFFSET : y}`;
}

export function formatDateLong(iso: string, ys: YearSystem = 'B'): string {
  const { y, m, d } = parseIso(iso);
  return `${d} ${MONTH_TH[m - 1]} ${ys === 'B' ? y + BE_OFFSET : y}`;
}

/**
 * อ่านวันที่ที่ผู้ใช้พิมพ์ — รับแบบเดียวกับ Express:
 *  "15/03/2569", "15/3/69", "150369", "15032569", "15/03" (ใช้ปีของ refIso)
 * ปีสองหลักถือเป็นปีในระบบปีของบริษัท (69 → 2569 ถ้าเป็น พ.ศ.)
 */
export function parseDateInput(text: string, ys: YearSystem = 'B', refIso?: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let d: number, m: number, y: number | undefined;
  const parts = t.split(/[/.\-\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    d = Number(parts[0]); m = Number(parts[1]); y = parts[2] !== undefined ? Number(parts[2]) : undefined;
  } else if (/^\d{4}$/.test(t)) {
    d = Number(t.slice(0, 2)); m = Number(t.slice(2, 4));
  } else if (/^\d{6}$/.test(t)) {
    d = Number(t.slice(0, 2)); m = Number(t.slice(2, 4)); y = Number(t.slice(4));
  } else if (/^\d{8}$/.test(t)) {
    d = Number(t.slice(0, 2)); m = Number(t.slice(2, 4)); y = Number(t.slice(4));
  } else return null;
  const refY = refIso ? parseIso(refIso).y : new Date().getFullYear();
  let ce: number;
  if (y === undefined) ce = refY;
  else {
    if (y < 100) {
      const refInSys = ys === 'B' ? refY + BE_OFFSET : refY;
      const century = Math.floor(refInSys / 100) * 100;
      y = century + y;
    }
    ce = ys === 'B' ? y - BE_OFFSET : y;
  }
  if (!isValidYmd(ce, m, d)) return null;
  return isoDate(ce, m, d);
}

export function addMonths(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return isoDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function endOfMonth(iso: string): string {
  const { y, m } = parseIso(iso);
  return isoDate(y, m, daysInMonth(y, m));
}

export function todayIso(): string {
  const n = new Date();
  return isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** ป้ายงวด เช่น "มี.ค. 2569" */
export function periodLabel(iso: string, ys: YearSystem = 'B'): string {
  const { y, m } = parseIso(iso);
  return `${MONTH_TH_SHORT[m - 1]} ${ys === 'B' ? y + BE_OFFSET : y}`;
}
