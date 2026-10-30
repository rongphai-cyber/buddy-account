import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** รากของไฟล์ที่โปรแกรมอ่าน (migration แบบผังบัญชี หน้าเว็บ) — ตัวติดตั้ง Windows ตั้ง BUDDY_ROOT เป็นโฟลเดอร์ app ของโปรแกรม */
export const REPO_ROOT = process.env.BUDDY_ROOT ?? resolve(here, '../../..');

export interface Config {
  port: number;
  host: string;
  databaseUrl?: string;
  dataDir?: string;
  migrationsDir: string;
  webDist: string;
  /** อายุ session (ชั่วโมง) */
  sessionHours: number;
  cookieSecure: boolean;
  /** หน้าสมัครใช้งานเอง: review = ผู้ให้บริการอนุมัติก่อน (ค่าเริ่มต้น) · auto = เปิดบัญชีทันที · off = ปิด */
  signup: 'off' | 'review' | 'auto';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4100),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATABASE_URL ? undefined : (env.BUDDY_DATA_DIR ?? resolve(REPO_ROOT, '.data/buddy')),
    migrationsDir: env.BUDDY_MIGRATIONS_DIR ?? resolve(REPO_ROOT, 'db/migrations'),
    webDist: env.BUDDY_WEB_DIST ?? resolve(REPO_ROOT, 'apps/web/dist'),
    sessionHours: Number(env.BUDDY_SESSION_HOURS ?? 12),
    cookieSecure: env.BUDDY_COOKIE_SECURE === '1',
    signup: env.BUDDY_SIGNUP === 'off' || env.BUDDY_SIGNUP === 'auto' ? env.BUDDY_SIGNUP : 'review',
  };
}
