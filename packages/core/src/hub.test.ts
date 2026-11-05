import { describe, expect, it } from 'vitest';
import { aggregateSync, checkAppUrl, HUB_APPS, HUB_ORDER, hubTileState, syncStateOf, syncText, TENANT_MODULES } from './index.js';

const now = new Date('2026-11-05T07:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe('Hub (docs/17 B6.2)', () => {
  it('ทุกโมดูลมีไทล์ · Buddy อยู่ซ้ายสุด', () => {
    expect(HUB_ORDER[0]).toBe('buddy');
    expect([...HUB_ORDER].sort()).toEqual(TENANT_MODULES.map((m) => m.key).sort());
    expect(HUB_APPS.pos.launch).toBe('sso');
  });
  it('สถานะคิว: ไม่ผ่าน > ไม่ได้รับสถานะ > รอส่ง > ปกติ', () => {
    expect(syncStateOf({ pending: 0, failed: 0, reported_at: ago(1) }, now)).toBe('online');
    expect(syncStateOf({ pending: 3, failed: 0, reported_at: ago(1) }, now)).toBe('syncing');
    expect(syncStateOf({ pending: 3, failed: 0, reported_at: ago(16) }, now)).toBe('offline');
    expect(syncStateOf({ pending: 0, failed: 1, reported_at: ago(60) }, now)).toBe('error');
    expect(syncStateOf({ pending: 0, failed: 0, reported_at: 'x' }, now)).toBe('offline');
  });
  it('รวมทุกโปรแกรม = สถานะที่แย่ที่สุด จำนวนรวมกัน', () => {
    expect(aggregateSync([], now)).toBeNull();
    expect(aggregateSync([{ pending: 2, failed: 0, reported_at: ago(1) }, { pending: 1, failed: 0, reported_at: ago(2) }], now)).toEqual({ state: 'syncing', pending: 3, failed: 0 });
    expect(aggregateSync([{ pending: 2, failed: 0, reported_at: ago(1) }, { pending: 0, failed: 4, reported_at: ago(2) }], now)).toEqual({ state: 'error', pending: 2, failed: 4 });
    expect(syncText('error', 0, 4, 'WTS-POS')).toContain('ไม่ผ่าน 4 รายการ');
  });
  it('ไทล์: กำลังพัฒนา / ยังไม่เปิด / หมดอายุ / ยังไม่ตั้งที่อยู่', () => {
    const on = { active: true, expired: false, valid_to: null };
    expect(hubTileState('living', on, 'https://x').status).toBe('soon');
    expect(hubTileState('pos', { active: false, expired: false, valid_to: null }, 'https://x')).toMatchObject({ status: 'locked' });
    expect(hubTileState('pos', { active: false, expired: true, valid_to: '2026-01-01' }, null).reason).toContain('หมดอายุ');
    expect(hubTileState('pos', on, null).reason).toContain('ยังไม่ได้ตั้งที่อยู่');
    expect(hubTileState('pos', on, 'https://pos.example.com/office/')).toEqual({ status: 'active', reason: null });
    expect(hubTileState('buddy', on, null)).toEqual({ status: 'active', reason: null });
  });
  it('ที่อยู่โปรแกรม', () => {
    expect(checkAppUrl('https://wtspos.example.com/office/')).toBeNull();
    expect(checkAppUrl('http://localhost:4300/office/')).toBeNull();
    expect(checkAppUrl('javascript:alert(1)')).not.toBeNull();
    expect(checkAppUrl('https://x.com/#a')).not.toBeNull();
    expect(checkAppUrl('wtspos.example.com')).not.toBeNull();
  });
});
