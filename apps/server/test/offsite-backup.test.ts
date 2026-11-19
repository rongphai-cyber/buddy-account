// สำเนาสำรองนอกเครื่อง (tools/cloud/offsite.mjs · HANDOFF 146): เข้ารหัส · ส่งโฟลเดอร์ที่สอง/R2 (fetch จำลอง ไม่ต่อเครือข่ายจริง) · อ่านกลับตรง · ลบชุดเก่ากว่า 90 วัน · ถอดรหัสกลับ
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { signRequest } from '../src/storage/sigv4.js';

type Offsite = {
  encrypt: (k: Buffer, b: Buffer) => Buffer; decrypt: (k: Buffer, b: Buffer) => Buffer; keyId: (k: Buffer) => string; newKeyFile: (f: string) => Buffer;
  signV4: (c: Record<string, string>, i: { method: string; url: string; payloadHash: string; date: Date; headers?: Record<string, string> }) => Record<string, string>;
  offsiteConfig: (root: string, env: Record<string, string>) => { keyFile: string; keepDays: number; targets: Array<{ kind: string; label: string }>; secrets: string[] };
  sendOffsite: (dir: string, cfg: unknown, o?: { fetchImpl?: typeof fetch; now?: number }) => Promise<Array<{ label: string; ok: boolean; message: string }>>;
  fetchOffsite: (o: { source: string; out: string; key: Buffer; r2?: unknown; prefix?: string; fetchImpl?: typeof fetch }) => Promise<{ set: string; files: number }>;
};
const load = async () => (await import(pathToFileURL(resolve(__dirname, '../../../tools/cloud/offsite.mjs')).href)) as Offsite;

/** R2 จำลองในหน่วยความจำ: PUT/GET/DELETE + ListObjectsV2 (ตรวจว่ามีลายเซ็นทุกคำขอ) */
function fakeR2() {
  const store = new Map<string, Buffer>();
  const seen: string[] = [];
  const impl = (async (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer }) => {
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKTEST\//);
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
    seen.push(`${init.method} ${key}`);
    if (init.method === 'PUT') { store.set(key, Buffer.from(init.body!)); return new Response('', { status: 200 }); }
    if (init.method === 'DELETE') { store.delete(key); return new Response(null, { status: 204 }); }
    if (u.searchParams.get('list-type') === '2') {
      const p = u.searchParams.get('prefix') ?? '';
      return new Response(`<ListBucketResult>${[...store.keys()].filter((k) => k.startsWith(p)).map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    const b = store.get(key);
    return b ? new Response(new Uint8Array(b)) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { store, seen, impl };
}

describe('สำเนาสำรองนอกเครื่อง (HANDOFF 146)', () => {
  it('encrypts with the owner key; wrong key fails; signature equals the server SigV4', async () => {
    const m = await load();
    const tmp = mkdtempSync(join(tmpdir(), 'offsite-'));
    try {
      const key = m.newKeyFile(join(tmp, 'k.key'));
      expect(() => m.newKeyFile(join(tmp, 'k.key'))).toThrow(/ไม่สร้างทับ/);
      const data = Buffer.from('ข้อมูลสำรอง pg_dump '.repeat(50));
      const enc = m.encrypt(key, data);
      expect(enc.includes(Buffer.from('pg_dump'))).toBe(false);
      expect(m.decrypt(key, enc).equals(data)).toBe(true);
      expect(() => m.decrypt(Buffer.alloc(32, 7), enc)).toThrow(/กุญแจไม่ตรง/);
      const cred = { accessKeyId: 'AKTEST', secretAccessKey: 'secret-test-value', region: 'auto', service: 's3' };
      const date = new Date('2026-11-19T05:30:00Z');
      const url = 'https://acc.r2.cloudflarestorage.com/wts-backup-offsite/cloud-backup/2569-11-19_1230/buddy.dump.enc';
      const hash = 'a'.repeat(64);
      const mine = m.signV4(cred, { method: 'PUT', url, payloadHash: hash, date });
      const server = signRequest(cred, { method: 'PUT', url, payloadHash: hash, date, headers: { 'x-amz-content-sha256': hash } });
      expect(mine.authorization).toBe(server.authorization);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('sends a verified set to a second folder and R2, prunes sets older than 90 days, and fetches back byte-identical', async () => {
    const m = await load();
    const tmp = mkdtempSync(join(tmpdir(), 'offsite-'));
    try {
      const root = join(tmp, 'repo'); mkdirSync(join(root, '.data'), { recursive: true });
      const second = join(tmp, 'second'); mkdirSync(second);
      writeFileSync(join(root, '.data/backup-offsite.json'), JSON.stringify({ folder: second }));
      const env = { BACKUP_R2_BUCKET: 'wts-backup-offsite', BACKUP_R2_ACCESS_KEY_ID: 'AKTEST', BACKUP_R2_SECRET_ACCESS_KEY: 'secret-test-value', R2_ACCOUNT_ID: 'acc' };
      const cfg = m.offsiteConfig(root, env);
      expect(cfg.targets.map((t) => t.kind)).toEqual(['folder', 'r2']);
      expect(cfg.secrets).toEqual(['AKTEST', 'secret-test-value']);
      // ไม่มีกุญแจ = แจ้งชัด ไม่ส่ง
      const set = join(tmp, 'local', '2569-11-19_1230'); mkdirSync(set, { recursive: true });
      writeFileSync(join(set, 'buddy.dump'), Buffer.from('dump-buddy-'.repeat(1000)));
      writeFileSync(join(set, 'manifest.json'), '{"format":"wts-cloud-backup"}\n');
      writeFileSync(join(set, 'restore-check.json'), '{"ok":true}\n');
      const r2 = fakeR2();
      expect((await m.sendOffsite(set, cfg, { fetchImpl: r2.impl }))[0]!.message).toMatch(/ไม่พบกุญแจ/);
      const key = m.newKeyFile(cfg.keyFile);
      // ชุดเก่า: 100 วัน (ลบ) · 10 วัน (เก็บ)
      for (const n of ['2569-08-01_1230', '2569-11-09_1230']) { mkdirSync(join(second, n)); r2.store.set(`cloud-backup/${n}/x.enc`, Buffer.from('old')); }
      mkdirSync(join(second, 'ของเจ้าของ'));   // โฟลเดอร์อื่นไม่ถูกแตะ
      const now = Date.UTC(2026, 10, 19, 6);
      const res = await m.sendOffsite(set, cfg, { fetchImpl: r2.impl, now });
      expect(res.map((r) => r.ok), JSON.stringify(res)).toEqual([true, true]);
      expect(res[0]!.message).toMatch(/3 ไฟล์ เข้ารหัสแล้ว อ่านกลับตรง · ลบชุดเก่ากว่า 90 วัน 1/);
      expect(readdirSync(second).sort()).toEqual(['2569-11-09_1230', '2569-11-19_1230', 'ของเจ้าของ']);
      expect([...r2.store.keys()].some((k) => k.startsWith('cloud-backup/2569-08-01_1230/'))).toBe(false);
      expect(r2.store.has('cloud-backup/2569-11-19_1230/buddy.dump.enc')).toBe(true);
      expect(readFileSync(join(second, '2569-11-19_1230', 'buddy.dump.enc')).includes(Buffer.from('dump-buddy'))).toBe(false);
      const idx = JSON.parse(readFileSync(join(second, '2569-11-19_1230', 'offsite.json'), 'utf8'));
      expect([idx.key_id, Object.keys(idx.files).sort()]).toEqual([m.keyId(key), ['buddy.dump', 'manifest.json', 'restore-check.json']]);
      // ถอดรหัสกลับ (โฟลเดอร์ และ R2) ได้ไฟล์เดิมทุกไบต์ · กุญแจผิด = ปฏิเสธ
      const back1 = join(tmp, 'back1'), back2 = join(tmp, 'back2');
      expect(await m.fetchOffsite({ source: join(second, '2569-11-19_1230'), out: back1, key })).toEqual({ set: '2569-11-19_1230', files: 3 });
      const r2cfg = { accountId: 'acc', bucket: 'wts-backup-offsite', accessKeyId: 'AKTEST', secretAccessKey: 'secret-test-value' };
      expect((await m.fetchOffsite({ source: '2569-11-19_1230', out: back2, key, r2: r2cfg, prefix: 'cloud-backup', fetchImpl: r2.impl })).files).toBe(3);
      for (const n of ['buddy.dump', 'manifest.json', 'restore-check.json']) {
        expect(readFileSync(join(back1, n)).equals(readFileSync(join(set, n)))).toBe(true);
        expect(readFileSync(join(back2, n)).equals(readFileSync(join(set, n)))).toBe(true);
      }
      await expect(m.fetchOffsite({ source: join(second, '2569-11-19_1230'), out: join(tmp, 'back3'), key: Buffer.alloc(32, 1) })).rejects.toThrow(/กุญแจไม่ตรงกับชุดนี้/);
      // โฟลเดอร์ที่สองหาย (ไดรฟ์ไม่ได้เสียบ) = แจ้งไม่สำเร็จ R2 ยังส่ง
      rmSync(second, { recursive: true, force: true });
      const r3 = await m.sendOffsite(set, cfg, { fetchImpl: r2.impl, now });
      expect(r3.map((r) => r.ok)).toEqual([false, true]);
      expect(r3[0]!.message).toMatch(/ไม่พบโฟลเดอร์/);
      expect(existsSync(second)).toBe(false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
