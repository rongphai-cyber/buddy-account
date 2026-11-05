/**
 * WTS Solutions Hub (docs/17 B6.2) — กติกาที่ไม่ขึ้นกับฐานข้อมูล: ไทล์แต่ละโปรแกรมเปิดได้หรือไม่ · สถานะคิวส่งเอกสาร (SyncStatus)
 * สถานะคิวมาจากโปรแกรมนั้นรายงานเข้ามาเอง (PUT /api/v1/source-status) — Buddy ไม่ไปดึงจากโปรแกรมอื่น
 */
import type { TenantModuleKey } from './tenant-modules.js';

/** ใช้ในโปรแกรมนี้: sso = เปิดพร้อมบัตรผ่าน (ไม่ต้องล็อกอินซ้ำ) · link = เปิดหน้าเว็บ ล็อกอินที่โปรแกรมนั้น · soon = ยังไม่พร้อมใช้ · self = Buddy เอง */
export type HubLaunch = 'self' | 'sso' | 'link' | 'soon';
/** สีประจำโมดูลตาม Design System WTS Solutions (living ใช้สีเพิ่มของ Buddy) */
export type HubTone = 'erp' | 'pos' | 'hotel' | 'hr' | 'spa' | 'living';

export const HUB_APPS: Record<TenantModuleKey, { name: string; description: string; mark: string; tone: HubTone; launch: HubLaunch; source: string | null; audience: string | null }> = {
  buddy: { name: 'Buddy Account', description: 'บัญชี ภาษี สต๊อก ต้นทุน งบการเงิน', mark: 'ERP', tone: 'erp', launch: 'self', source: null, audience: null },
  pos: { name: 'WTS-POS', description: 'หน้าร้าน ครัวกลาง แฟรนไชส์', mark: 'POS', tone: 'pos', launch: 'sso', source: 'wts-pos', audience: 'wts-pos' },
  hotel: { name: 'Hotel', description: 'โรงแรม ห้องพัก เช็คอิน', mark: 'PMS', tone: 'hotel', launch: 'soon', source: 'wts-hotel', audience: 'wts-hotel' },
  hr: { name: 'WTS-SOP', description: 'HR และเงินเดือน', mark: 'HR', tone: 'hr', launch: 'link', source: 'wts-sop', audience: 'wts-sop' },
  spa: { name: 'Spa', description: 'สปา นัดหมาย คอร์ส', mark: 'SPA', tone: 'spa', launch: 'soon', source: 'wts-spa', audience: 'wts-spa' },
  living: { name: 'WTS-Living', description: 'หอพัก อพาร์ตเมนต์ นิติบุคคล', mark: 'LIV', tone: 'living', launch: 'sso', source: 'wts-living', audience: 'wts-living' },
};
/** ลำดับไทล์: Buddy ใหญ่ซ้าย แล้ว POS Hotel HR Spa Living (ผังใน Design System) */
export const HUB_ORDER: TenantModuleKey[] = ['buddy', 'pos', 'hotel', 'hr', 'spa', 'living'];

/** โปรแกรมที่ไม่ได้รายงานสถานะนานเกินนี้ = "ไม่ได้รับสถานะ" (โปรแกรมรายงานทุก 1–5 นาที) */
export const SOURCE_STALE_MINUTES = 15;

export type SyncState = 'online' | 'syncing' | 'error' | 'offline';
export type SourceStatusRow = { pending: number; failed: number; reported_at: string | Date };

/** สถานะคิวของโปรแกรมหนึ่ง: ส่งไม่ผ่าน > ไม่ได้รับสถานะ > รอส่ง > ปกติ */
export function syncStateOf(r: SourceStatusRow, now: Date = new Date()): SyncState {
  if (r.failed > 0) return 'error';
  const at = r.reported_at instanceof Date ? r.reported_at : new Date(r.reported_at);
  if (!(at.getTime() > 0) || now.getTime() - at.getTime() > SOURCE_STALE_MINUTES * 60_000) return 'offline';
  if (r.pending > 0) return 'syncing';
  return 'online';
}

const RANK: Record<SyncState, number> = { online: 0, syncing: 1, offline: 2, error: 3 };
/** รวมทุกโปรแกรม: แสดงสถานะที่แย่ที่สุด · จำนวนรอส่ง/ไม่ผ่านรวมกัน · ไม่มีโปรแกรมรายงานเลย = null (ไม่ต้องแสดง) */
export function aggregateSync(rows: SourceStatusRow[], now: Date = new Date()): { state: SyncState; pending: number; failed: number } | null {
  if (!rows.length) return null;
  let state: SyncState = 'online';
  for (const r of rows) { const s = syncStateOf(r, now); if (RANK[s] > RANK[state]) state = s; }
  return { state, pending: rows.reduce((n, r) => n + r.pending, 0), failed: rows.reduce((n, r) => n + r.failed, 0) };
}

/** ข้อความสถานะภาษาไทย (สถานะมีคำกำกับเสมอ — ไม่ใช้สีอย่างเดียว) */
export function syncText(state: SyncState, pending: number, failed: number, who = '') {
  const w = who ? `${who} ` : '';
  if (state === 'error') return `${w}ส่งเข้าบัญชีไม่ผ่าน ${failed} รายการ — แก้ที่${who || 'โปรแกรมต้นทาง'}แล้วส่งใหม่`;
  if (state === 'offline') return `${w}ไม่ได้รับสถานะเกิน ${SOURCE_STALE_MINUTES} นาที — หน้าร้านยังขายได้ ตรวจเน็ตหรือเครื่องแม่ข่ายของโปรแกรม`;
  if (state === 'syncing') return `${w}รอส่งเข้าบัญชี ${pending} รายการ`;
  return `${w}ส่งเข้าบัญชีครบแล้ว`;
}

/** ไทล์เปิดได้ไหม — ข้อความบอกเหตุผลและวิธีแก้เมื่อเปิดไม่ได้ */
export function hubTileState(key: TenantModuleKey, m: { active: boolean; expired: boolean; valid_to: string | null }, appUrl: string | null):
  { status: 'active' | 'locked' | 'soon'; reason: string | null } {
  const app = HUB_APPS[key];
  if (app.launch === 'soon') return { status: 'soon', reason: `${app.name} กำลังพัฒนา` };
  if (!m.active) return { status: 'locked', reason: m.expired ? `สิทธิ์ใช้ ${app.name} หมดอายุแล้ว — ติดต่อผู้ให้บริการเพื่อต่ออายุ` : `ยังไม่ได้เปิดใช้ ${app.name} — ติดต่อผู้ให้บริการเพื่อเปิดใช้` };
  if (app.launch !== 'self' && !appUrl) return { status: 'active', reason: `ยังไม่ได้ตั้งที่อยู่ของ ${app.name} — ผู้ให้บริการตั้งได้ที่ ลูกค้าผู้ใช้บริการ › โปรแกรมที่ลูกค้าใช้ได้` };
  return { status: 'active', reason: null };
}

/** ที่อยู่โปรแกรม: http(s) เท่านั้น ไม่มีช่องว่าง/fragment (Hub ต่อท้ายด้วย #buddy_sso=…) */
export function checkAppUrl(url: string): string | null {
  if (!/^https?:\/\/[^\s#]+$/i.test(url)) return 'ที่อยู่โปรแกรมต้องขึ้นต้นด้วย https:// หรือ http:// และไม่มีช่องว่างหรือ # เช่น https://wtspos.example.com/office/';
  try { new URL(url); } catch { return 'ที่อยู่โปรแกรมไม่ถูกต้อง เช่น https://wtspos.example.com/office/'; }
  return null;
}
