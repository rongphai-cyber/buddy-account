/**
 * การจัดหน้าเอกสารพิมพ์ (HANDOFF 153 แบ่งหน้า + HANDOFF 178 ส่วนท้ายชิดล่าง/เติมบรรทัดว่าง)
 * ส่วนที่คำนวณได้โดยไม่ต้องมีหน้าจอ — หน้าเว็บ (apps/web/src/printPages.tsx) วัดความสูงจริงแล้วเรียกใช้
 */

/** พื้นที่ว่างระหว่างรายการกับยอดรวม (เจ้าของ 23/11/2569 "ตรงกลางถ้าว่างให้แสดงเป็นบรรทัด หรือ…แถบสีบรรทัด") */
export type PrintBlankArea = 'lines' | 'zebra' | 'none';
export const PRINT_BLANK_AREAS: Array<{ key: PrintBlankArea; label: string }> = [
  { key: 'lines', label: 'เส้นบรรทัด' }, { key: 'zebra', label: 'แถบสีสลับบรรทัด' }, { key: 'none', label: 'ว่าง (ไม่มีเส้น)' },
];

/** กลุ่มแถวในตาราง (แถว + หมายเหตุของแถว) · fill = บรรทัดว่างเติมตาราง (บรรทัดขั้นต่ำ) */
export interface PageGroup { h: number; fill: boolean }

/**
 * แบ่งกลุ่มแถวเป็นหน้า: avail = ความสูงที่ใส่แถวได้ต่อหน้า (หลังหักส่วนหัว/หัวตาราง/เลขหน้า) · tailNeed = ยอดรวม+ลงชื่อ+ท้ายเอกสาร (อยู่หน้าสุดท้าย)
 * - แถวที่ไม่ใช่บรรทัดเติม เรียงลงหน้าจนเต็ม · หน้าสุดท้ายต้องมีที่ให้ส่วนท้าย ไม่พอ = ยกแถวสุดท้ายไปหน้าใหม่ด้วยหนึ่งแถว (ส่วนท้ายไม่อยู่หน้าเดี่ยว ๆ)
 * - บรรทัดเติม (บรรทัดขั้นต่ำ) อยู่หน้าสุดท้ายเท่าที่ที่ว่างพอ
 * คืนค่า: ดัชนีกลุ่มของแต่ละหน้า (อย่างน้อย 1 หน้า)
 */
export function planPages(groups: readonly PageGroup[], avail: number, tailNeed: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [], used = 0;
  const rows = groups.map((g, i) => ({ ...g, i }));
  for (const g of rows.filter((x) => !x.fill)) {
    if (cur.length && used + g.h > avail) { pages.push(cur); cur = []; used = 0; }
    cur.push(g.i); used += g.h;
  }
  if (used + tailNeed > avail) {
    if (cur.length > 1) { const moved = cur.pop()!; pages.push(cur); cur = [moved]; used = groups[moved]!.h; }
    else if (cur.length === 1 && tailNeed < avail) { pages.push(cur); cur = []; used = 0; }
  }
  for (const g of rows.filter((x) => x.fill)) { if (used + g.h + tailNeed > avail) break; cur.push(g.i); used += g.h; }
  pages.push(cur);
  return pages;
}

/** จำนวนบรรทัดว่างที่เติมได้ในที่ว่าง (free) เมื่อแต่ละบรรทัดสูง rowH — ไม่เกิน max · ที่ว่างไม่พอหนึ่งบรรทัด = 0 */
export function blankRowCount(free: number, rowH: number, max = 200): number {
  if (!(rowH > 0) || !(free > 0)) return 0;
  return Math.max(0, Math.min(max, Math.floor((free + 0.5) / rowH)));
}

/** ข้อความเลขหน้า: หน้าเดียว = ไม่พิมพ์ · ไทย "หน้า 1/2" · อังกฤษ "Page 1 of 2" */
export function pageLabel(page: number, total: number, en = false): string {
  if (total <= 1) return '';
  return en ? `Page ${page} of ${total}` : `หน้า ${page}/${total}`;
}

/** ขนาดอักษร (เท่าของขนาดเดิม) ที่ทำให้ข้อความกว้าง need ใส่ในช่องกว้าง have ได้ — ไม่ต่ำกว่า min · ใส่ได้อยู่แล้ว = 1 */
export function shrinkToFit(need: number, have: number, min = 0.7): number {
  if (!(need > have) || !(have > 0)) return 1;
  return Math.max(min, Math.floor((have / need) * 100) / 100);
}
