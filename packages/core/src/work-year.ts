/**
 * ปีบัญชีที่กำลังทำงาน (HANDOFF 174 — เจ้าของ 23/11/2569 "คลิกว่าเราทำงานอยุ่กับงวดปีไหนได้หรือไม่ เพื่อให้ระบบทราบว่าเราทำงานปัจจุบันกับงวดบัญชีไหน")
 * ปีบัญชี = ปีที่มีวันทำการอยู่ · หน้ารายการ/รายงานที่มีช่วงวันที่เริ่มที่ต้นปีบัญชี–สิ้นปีบัญชีของวันทำการ (ใช้ร่วมทุกหน้าจอ)
 * ไม่มีปีบัญชีที่ครอบวันทำการ (ยังไม่ได้เปิดปี) = ปีปฏิทินของวันทำการ
 */
export interface FiscalYearLike { id?: string; code?: string; start_date: string; end_date: string; status?: string }
const iso = (v: string) => String(v).slice(0, 10);

/** ปีบัญชีที่มีวันนี้อยู่ (null = ไม่มี) */
export function fiscalYearOf<T extends FiscalYearLike>(date: string, years: readonly T[] | null | undefined): T | null {
  const d = iso(date);
  return years?.find((y) => iso(y.start_date) <= d && iso(y.end_date) >= d) ?? null;
}

/** ช่วงวันที่ค่าเริ่มต้นของหน้ารายการ/รายงาน: ต้นปีบัญชี–สิ้นปีบัญชีของวันทำการ (ไม่มีปีบัญชี = 1 ม.ค.–31 ธ.ค. ของวันทำการ) */
export function workRange(workDate: string, years: readonly FiscalYearLike[] | null | undefined): { from: string; to: string } {
  const y = fiscalYearOf(workDate, years);
  if (y) return { from: iso(y.start_date), to: iso(y.end_date) };
  const yr = iso(workDate).slice(0, 4);
  return { from: `${yr}-01-01`, to: `${yr}-12-31` };
}

/** วันทำการเมื่อเลือกปีบัญชี: ปีปัจจุบัน = วันนี้ · ปีที่ผ่านมา/ปิดแล้ว = สิ้นปี · ปีถัดไป = ต้นปี */
export function workDateForYear(y: FiscalYearLike, today: string): string {
  const t = iso(today), s = iso(y.start_date), e = iso(y.end_date);
  return t < s ? s : t > e ? e : t;
}

/** ชื่อปีบัญชีที่แสดง: รหัสปีบัญชีของบริษัท (เช่น 2568) · ไม่มีรหัส = ปีของวันสิ้นปีตามระบบปีของบริษัท (พ.ศ. +543) */
export function fiscalYearLabel(y: FiscalYearLike, ys: 'B' | 'C' = 'B'): string {
  if (y.code) return y.code;
  const yr = Number(iso(y.end_date).slice(0, 4));
  return String(ys === 'B' ? yr + 543 : yr);
}

/**
 * Open-years warning (HANDOFF 176): more than `keep` fiscal years still open (status 'O') = the oldest open years
 * beyond the newest `keep` have not been through year-end yet. Warning only; nothing is blocked.
 * Returns those oldest open years (oldest first), or [] when at most `keep` are open.
 */
export function staleOpenYears<T extends FiscalYearLike>(years: readonly T[] | null | undefined, keep = 3): T[] {
  const open = [...(years ?? [])].filter((y) => (y.status ?? 'O') === 'O').sort((a, b) => iso(a.start_date).localeCompare(iso(b.start_date)));
  return open.length > keep ? open.slice(0, open.length - keep) : [];
}
