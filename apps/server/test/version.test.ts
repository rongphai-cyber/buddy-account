/**
 * รุ่นของโปรแกรม (เจ้าของ 10/11/2569): version.json ที่ราก repo ตั้งด้วย node tools/version/stamp.mjs
 * /api/v1/health ตอบรุ่นนี้ (หน้าจอแสดงรุ่นเดียวกันจาก vite define) — ใช้เทียบว่าคลาวด์เป็นรุ่นล่าสุด
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appVersion } from '../src/app.js';

describe('รุ่นของโปรแกรม', () => {
  it('version.json อยู่ในรูปแบบ พ.ศ.เดือน.วัน-ครั้งที่ และเซิร์ฟเวอร์อ่านค่าเดียวกัน', () => {
    const v = JSON.parse(readFileSync(new URL('../../../version.json', import.meta.url), 'utf8')).version as string;
    expect(v).toMatch(/^25\d{2}\.\d{2}\.\d{2}-\d+$/);
    expect(appVersion()).toBe(process.env.BUDDY_VERSION || v);
  });
});
