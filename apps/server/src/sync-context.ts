import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './db.js';

/**
 * T7.8 ออฟไลน์สาขา — ค่าที่ส่งผ่านคำขอหนึ่งครั้งไปถึงทรานแซกชันของคำขอ (runInCompanyScope) และการออกเลขที่ (issueDocNo)
 * replay  = สำนักงานใหญ่กำลังบันทึกคำขอที่ส่งมาจากเครื่องสาขา: ใช้รหัสแถวเดิม (app.force_ids) และเลขที่เอกสารเดิม
 * capture = เครื่องสาขากำลังบันทึกเอกสาร: จดรหัสแถวที่สร้าง (app.capture) แล้วเขียนคิวรอส่งในทรานแซกชันเดียวกับเอกสาร
 */
export type SyncReplay = { deviceId: string; forceIds: Record<string, string[]>; docNo: string | null };
export type SyncCapture = { onCommit: (tx: Db, created: Record<string, string[]>) => Promise<void> };
/** branch = คำขอนี้อยู่บนเครื่องสาขา (เลขที่เอกสารจากช่วงที่จองให้เครื่อง) */
export const syncCtx = new AsyncLocalStorage<{ replay?: SyncReplay; capture?: SyncCapture; branch?: { device_id: string } }>();

/** งาน replay ที่รออยู่: สำนักงานใหญ่ส่งคำขอภายใน (app.inject) พร้อม header x-buddy-replay = กุญแจสุ่มครั้งเดียว — คนภายนอกปลอมไม่ได้ */
export const replays = new Map<string, SyncReplay>();

/** การออกเลขที่แทนแบบปกติ (เครื่องสาขา = ช่วงเลขของเครื่อง · สำนักงานใหญ่ตอน replay = เลขเดิมจากสาขา) — null = ออกเลขตามปกติ */
export const numbering: { hook: ((tx: Db, companyId: string, docTypeId: string) => Promise<string | null>) | null } = { hook: null };
