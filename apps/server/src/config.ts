import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');

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
  };
}
