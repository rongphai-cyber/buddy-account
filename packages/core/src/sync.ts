/**
 * T7.8 ออฟไลน์สาขา — เครื่องสาขาคือ Buddy Account ที่ติดตั้งที่สาขา ทำงานกับสำเนาข้อมูลของบริษัทเดียว
 * ออกเอกสารชนิดที่กำหนดได้แม้ไม่มีอินเทอร์เน็ต (เลขที่จากช่วงที่จองไว้ให้เครื่อง) แล้วส่งให้สำนักงานใหญ่บันทึกซ้ำด้วยตรรกะเดียวกัน
 * งานอื่นทำที่สำนักงานใหญ่ (เปิดเว็บสำนักงานใหญ่เมื่อมีอินเทอร์เน็ต)
 */
export type OfflineAction = { method: 'POST'; path: string; cls: string | null; label: string };
/** คำขอที่เครื่องสาขาบันทึกได้ (ตามแบบ: ขายเงินสด ขายเชื่อ รับชำระ เสนอราคา สั่งขาย จ่าย/โอน/ปรับปรุงสินค้า เงินสดย่อย + ลูกค้าใหม่) */
export const OFFLINE_ACTIONS: OfflineAction[] = [
  { method: 'POST', path: '/api/v1/cash-sales', cls: 'HS', label: 'ขายเงินสด' },
  { method: 'POST', path: '/api/v1/sales-invoices', cls: 'IV', label: 'ขายเงินเชื่อ' },
  { method: 'POST', path: '/api/v1/ar-receipts', cls: 'RE', label: 'รับชำระหนี้' },
  { method: 'POST', path: '/api/v1/quotations', cls: 'QT', label: 'ใบเสนอราคา' },
  { method: 'POST', path: '/api/v1/sales-orders', cls: 'SO', label: 'ใบสั่งขาย' },
  { method: 'POST', path: '/api/v1/stock-issues', cls: 'OU', label: 'จ่ายสินค้าใช้ภายใน' },
  { method: 'POST', path: '/api/v1/stock-transfers', cls: 'RL', label: 'โอนย้ายระหว่างคลัง' },
  { method: 'POST', path: '/api/v1/stock-adjustments', cls: 'JU', label: 'ปรับปรุงสินค้า' },
  { method: 'POST', path: '/api/v1/petty-payments', cls: 'DP', label: 'จ่ายเงินสดย่อย' },
  { method: 'POST', path: '/api/v1/customers', cls: null, label: 'เพิ่มลูกค้า' },
];
export const OFFLINE_DOC_CLASSES = OFFLINE_ACTIONS.map((a) => a.cls).filter((c): c is string => !!c);
export const offlineActionOf = (method: string, path: string) => OFFLINE_ACTIONS.find((a) => a.method === method && a.path === path) ?? null;
/** จำนวนเลขที่ที่จองให้เครื่องต่อประเภทเอกสารต่อครั้ง · เหลือน้อยกว่า 20% ขอช่วงใหม่ตอนซิงก์ */
export const SYNC_BLOCK_SIZE = 200;
export const SYNC_REFILL_RATIO = 0.2;

/** แยกตาราง:รหัส จาก app.cap ("doc_header:uuid,doc_line:uuid,…") → { ตาราง: [รหัสตามลำดับที่สร้าง] } */
export function parseCapturedIds(cap: string | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of (cap ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    (out[part.slice(0, i)] ??= []).push(part.slice(i + 1));
  }
  return out;
}
/** เลขลำดับจากเลขที่เอกสาร (ตัวนำหน้า + เลข) — ไม่ใช่รูปแบบนี้ = null */
export function docNoSeq(prefix: string, docNo: string): number | null {
  if (!docNo.startsWith(prefix)) return null;
  const rest = docNo.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}
