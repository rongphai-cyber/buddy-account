/**
 * ที่เก็บไฟล์ของ Buddy (docs/20 ข้อ 9): ตั้งครั้งเดียวตอน buildApp จาก FILES_DRIVER / R2_* (ไม่ตั้ง = local พฤติกรรมเดิม)
 * ทดสอบใส่ตัวเก็บจำลองได้ด้วย buildApp(database, cfg, { files })
 */
import { resolve } from 'node:path';
import type { Config } from '../config.js';
import { REPO_ROOT } from '../config.js';
import { fileStoreFromEnv, localFilesDir, type FileStore } from './files.js';

let current: FileStore | null = null;

export function initFileStore(cfg: Config, override?: FileStore): FileStore {
  current = override ?? fileStoreFromEnv(process.env, localFilesDir(cfg.dataDir && !cfg.dataDir.includes('://') ? resolve(cfg.dataDir, '..') : resolve(REPO_ROOT, '.data')));
  return current;
}

export function fileStore(): FileStore {
  if (!current) throw new Error('ยังไม่ได้ตั้งที่เก็บไฟล์ (initFileStore)');
  return current;
}

/** ไฟล์ใหม่ขึ้นที่เก็บภายนอกหรือไม่ — local = เก็บในแถวฐานข้อมูลเหมือนเดิม */
export const offloadFiles = () => fileStore().driver === 'r2';

export * from './files.js';
