/**
 * ที่เก็บไฟล์ (docs/20 ข้อ 9) — ช่องทางเดียวสำหรับไฟล์ที่ผู้ใช้อัปโหลด (โลโก้ ลายเซ็น รูปสินค้า สลิป รูปมิเตอร์ …)
 *   local (ค่าเริ่มต้น) = พฤติกรรมเดิม: ไฟล์ของหน้าจอเดิมอยู่ในแถวฐานข้อมูลเหมือนเดิม (ตัวติดตั้ง Windows / PGlite ไม่เปลี่ยน)
 *         ตัวเก็บแบบโฟลเดอร์ (.data/files) ใช้กับไฟล์ที่ระบุด้วย key เท่านั้น
 *   r2    = Cloudflare R2 ผ่าน S3 API (fetch + SigV4 ของ node:crypto · ไม่มี AWS SDK) — ไฟล์ใหม่ขึ้น R2 แถวในฐานเก็บแค่ key
 * key = <company_id>/<kind>/<uuid>.<ext> → แยกไฟล์ของแต่ละบริษัทได้ (ส่งออก/ลบตามลูกค้า PDPA) · อ่านต้องผ่านการตรวจบริษัทของ
 * session ก่อนเสมอ แล้วจึงได้ที่อยู่แบบเซ็นอายุสั้น · bucket ไม่เปิดสาธารณะ · ห้ามพิมพ์ secret / ที่อยู่แบบเซ็นลง log
 * ไฟล์นี้เหมือนกันทั้ง Buddy · WTS-POS · WTS-Living — แก้ที่หนึ่งให้แก้ทุกที่
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { presignUrl, sha256Hex, signRequest, uriEncode, type SigV4Credentials } from './sigv4.js';

export interface StoredFile {
  body: Buffer;
  contentType: string;
}

export interface FileStore {
  readonly driver: 'local' | 'r2';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
  /** r2 = ที่อยู่ GET แบบเซ็นอายุสั้น · local = null (ให้โปรแกรมส่งไฟล์เองผ่าน API ที่ตรวจสิทธิ์แล้ว) */
  signedUrl(key: string, expiresInSec?: number): Promise<string | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z0-9][a-z0-9-]{0,39})\/([0-9a-f-]{36})\.([a-z0-9]{1,8})$/i;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
export const extOf = (mime: string) => EXT[mime.toLowerCase()] ?? 'bin';

/** key ใหม่ของไฟล์ — scopeId = รหัสบริษัท (หรือลูกค้าผู้ใช้บริการ) · kind เช่น logo, sign, item-image, slip */
export function fileKey(scopeId: string, kind: string, mime: string): string {
  if (!UUID.test(scopeId)) throw new Error('รหัสบริษัทของไฟล์ไม่ถูกต้อง');
  const key = `${scopeId.toLowerCase()}/${kind}/${randomUUID()}.${extOf(mime)}`;
  if (!KEY.test(key)) throw new Error(`ชนิดไฟล์ "${kind}" ใช้ตั้งชื่อไม่ได้ (a-z 0-9 -)`);
  return key;
}

export const isFileKey = (key: string) => KEY.test(key);
export const keyScope = (key: string) => KEY.exec(key)?.[1]?.toLowerCase() ?? null;

/** ไฟล์ต้องเป็นของบริษัทนี้ — ไม่ใช่ = ปฏิเสธ (กันอ่าน/ลบไฟล์ของบริษัทอื่นแม้ key รั่ว) */
export function assertKeyScope(key: string, scopeId: string): void {
  if (!isFileKey(key) || keyScope(key) !== scopeId.toLowerCase()) throw new FileScopeError();
}
export class FileScopeError extends Error {
  readonly statusCode = 404;
  constructor() { super('ไม่พบไฟล์ของบริษัทนี้'); }
}

/** ที่เก็บไฟล์ที่ตรวจบริษัททุกครั้ง (ใช้ในคำขอของผู้ใช้) */
export function scopedStore(store: FileStore, scopeId: string): FileStore {
  return {
    driver: store.driver,
    put: async (k, b, t) => { assertKeyScope(k, scopeId); return store.put(k, b, t); },
    get: async (k) => { assertKeyScope(k, scopeId); return store.get(k); },
    delete: async (k) => { assertKeyScope(k, scopeId); return store.delete(k); },
    signedUrl: async (k, s) => { assertKeyScope(k, scopeId); return store.signedUrl(k, s); },
  };
}

/* ------------------------------------------------------------------ local: โฟลเดอร์ในเครื่อง */
export function localFileStore(dir: string): FileStore {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    if (!isFileKey(key)) throw new Error('key ของไฟล์ไม่ถูกต้อง');
    const p = resolve(root, ...key.split('/'));
    if (!p.startsWith(root + sep)) throw new Error('key ของไฟล์ไม่ถูกต้อง');
    return p;
  };
  return {
    driver: 'local',
    async put(key, body, contentType) {
      const p = pathOf(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeFile(`${p}.type`, contentType);
    },
    async get(key) {
      const p = pathOf(key);
      try {
        return { body: await readFile(p), contentType: (await readFile(`${p}.type`, 'utf8').catch(() => 'application/octet-stream')).trim() };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async delete(key) {
      const p = pathOf(key);
      await rm(p, { force: true });
      await rm(`${p}.type`, { force: true });
    },
    async signedUrl() { return null; },
  };
}

/* ------------------------------------------------------------------ r2: Cloudflare R2 (S3 API) */
export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** โดเมนสาธารณะที่ผูกกับ bucket (ไม่บังคับ — ไม่ใช้กับ signedUrl) */
  publicBaseUrl?: string | undefined;
  /** ที่อยู่ปลายทาง (ค่าเริ่มต้น https://<account>.r2.cloudflarestorage.com) — ใช้ทดสอบ */
  endpoint?: string | undefined;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer }) => Promise<{ status: number; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

export class FileStoreError extends Error {
  constructor(op: string, readonly status: number, code: string) {
    super(`ที่เก็บไฟล์ตอบ ${status}${code ? ` ${code}` : ''} ตอน${op} — ตรวจค่า R2 (bucket, สิทธิ์ของ API token) แล้วลองใหม่`);
  }
}

export function r2FileStore(cfg: R2Config, fetchFn: FetchLike = fetch as unknown as FetchLike, now: () => Date = () => new Date()): FileStore {
  if (!/^[a-z0-9]{32}$/i.test(cfg.accountId) && !cfg.endpoint) throw new Error('R2_ACCOUNT_ID ต้องเป็นรหัสบัญชี Cloudflare 32 ตัว');
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('ตั้งค่า R2 ไม่ครบ (R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  const base = (cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
  const cred: SigV4Credentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: 'auto', service: 's3' };
  const urlOf = (key: string) => {
    if (!isFileKey(key)) throw new Error('key ของไฟล์ไม่ถูกต้อง');
    return `${base}/${uriEncode(cfg.bucket)}/${key.split('/').map(uriEncode).join('/')}`;
  };
  const code = async (r: { text(): Promise<string> }) => (await r.text().catch(() => '')).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
  const send = async (op: string, method: string, key: string, body?: Buffer, contentType?: string) => {
    const url = urlOf(key);
    const payloadHash = sha256Hex(body ?? '');
    const headers = signRequest(cred, { method, url, date: now(), payloadHash, headers: { 'x-amz-content-sha256': payloadHash, ...(contentType ? { 'content-type': contentType } : {}) } });
    const r = await fetchFn(url, { method, headers, ...(body ? { body } : {}) });
    return { r, op };
  };
  return {
    driver: 'r2',
    async put(key, body, contentType) {
      const { r } = await send('อัปโหลด', 'PUT', key, body, contentType);
      if (r.status !== 200) throw new FileStoreError('อัปโหลด', r.status, await code(r));
    },
    async get(key) {
      const { r } = await send('อ่านไฟล์', 'GET', key);
      if (r.status === 404) return null;
      if (r.status !== 200) throw new FileStoreError('อ่านไฟล์', r.status, await code(r));
      return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'application/octet-stream' };
    },
    async delete(key) {
      const { r } = await send('ลบไฟล์', 'DELETE', key);
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw new FileStoreError('ลบไฟล์', r.status, await code(r));
    },
    async signedUrl(key, expiresInSec = 300) {
      return presignUrl(cred, { method: 'GET', url: urlOf(key), date: now(), expiresIn: expiresInSec });
    },
  };
}

/* ------------------------------------------------------------------ จากค่าตั้ง */
/**
 * FILES_DRIVER=r2 + R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (+ R2_PUBLIC_BASE_URL ไม่บังคับ)
 * ไม่ตั้ง / local = โฟลเดอร์ localDir (ไฟล์ของหน้าจอเดิมยังอยู่ในฐานข้อมูลตามเดิม)
 */
export function fileStoreFromEnv(env: Record<string, string | undefined>, localDir: string): FileStore {
  const driver = (env.FILES_DRIVER ?? 'local').toLowerCase();
  if (driver === 'local' || driver === '') return localFileStore(localDir);
  if (driver !== 'r2') throw new Error(`FILES_DRIVER="${driver}" ไม่รู้จัก — ใช้ local หรือ r2`);
  return r2FileStore({
    accountId: env.R2_ACCOUNT_ID ?? '',
    bucket: env.R2_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || undefined,
  });
}

/** ไฟล์ของแถวที่ย้ายออกจากฐานข้อมูล: แบบเดิม (inline) หรือ key ในที่เก็บ — ใช้ร่วมกันตอนอ่าน */
export async function readStoredOrInline(store: FileStore, scopeId: string, row: { storage_key: string | null; inline: Buffer | null; mime: string }): Promise<StoredFile | null> {
  if (row.storage_key) return scopedStore(store, scopeId).get(row.storage_key);
  return row.inline && row.inline.length ? { body: row.inline, contentType: row.mime } : null;
}

export const localFilesDir = (dataRoot: string) => join(dataRoot, 'files');
