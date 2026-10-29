import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { REPO_ROOT } from './config.js';

/**
 * เข้ารหัสค่าลับของบริษัท (เช่น กุญแจ API ของ Claude) ด้วย AES-256-GCM
 * กุญแจหลัก: BUDDY_SECRET_KEY (base64 32 ไบต์) หรือแฟ้ม BUDDY_SECRET_FILE (ค่าเริ่มต้น .data/secret.key — สร้างให้ครั้งแรก)
 * ตัวติดตั้ง Windows ตั้งแฟ้มไว้ในโฟลเดอร์ข้อมูล จึงอยู่รอดตอนอัปเดตโปรแกรม · ย้ายฐานข้อมูลไปเครื่องอื่นโดยไม่มีแฟ้มนี้ = ต้องใส่กุญแจ API ใหม่
 */
let cached: Buffer | null = null;
function masterKey(): Buffer {
  if (process.env.BUDDY_SECRET_KEY) return Buffer.from(process.env.BUDDY_SECRET_KEY, 'base64');
  if (cached) return cached;
  const file = process.env.BUDDY_SECRET_FILE ?? resolve(REPO_ROOT, '.data/secret.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  cached = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (cached.length !== 32) throw new Error(`แฟ้มกุญแจหลัก ${file} ไม่ถูกต้อง (ต้องเป็น base64 ขนาด 32 ไบต์)`);
  return cached;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

/** ถอดรหัสไม่ได้ (กุญแจหลักเปลี่ยน/ข้อมูลเสีย) = null */
export function decryptSecret(enc: string): string | null {
  try {
    const [iv, tag, ct] = enc.split('.').map((x) => Buffer.from(x, 'base64'));
    const dc = createDecipheriv('aes-256-gcm', masterKey(), iv!);
    dc.setAuthTag(tag!);
    return Buffer.concat([dc.update(ct!), dc.final()]).toString('utf8');
  } catch { return null; }
}
