/**
 * ที่เก็บไฟล์ (docs/20 ข้อ 9): SigV4 เทียบชุดตัวอย่างที่ AWS เผยแพร่ · ตัวเก็บ r2 กับ fetch จำลอง (ไม่มีเครือข่ายจริง)
 * · ตัวเก็บ local · ปฏิเสธ key ของบริษัทอื่น — ไฟล์ทดสอบนี้เหมือนกันทั้ง Buddy · WTS-POS · WTS-Living
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { presignUrl, sha256Hex, signatureParts, signRequest } from '../src/storage/sigv4.js';
import { assertKeyScope, fileKey, fileStoreFromEnv, FileScopeError, localFileStore, r2FileStore, scopedStore, type FetchLike } from '../src/storage/files.js';

describe('SigV4 — AWS published test vectors', () => {
  // aws-sig-v4-test-suite: get-vanilla / get-vanilla-query-order-key-case
  const suite = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' };
  const at = new Date('2015-08-30T12:36:00Z');
  it('get-vanilla', () => {
    const h = signRequest(suite, { method: 'GET', url: 'https://example.amazonaws.com/', date: at });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    expect(h['x-amz-date']).toBe('20150830T123600Z');
  });
  it('get-vanilla-query-order-key-case', () => {
    const p = signatureParts(suite, { method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', date: at, headers: { 'X-Amz-Date': '20150830T123600Z' } });
    expect(p.signature).toBe('b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  });
  // Amazon S3 API reference "Signature Calculations for the Authorization Header" + "Authenticating Requests: Using Query Parameters"
  const s3 = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' };
  const may = new Date('2013-05-24T00:00:00Z');
  it('S3 GET object with Range', () => {
    const p = signatureParts(s3, {
      method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', date: may, payloadHash: sha256Hex(''),
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': sha256Hex(''), 'x-amz-date': '20130524T000000Z' },
    });
    expect(p.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date');
    expect(p.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('S3 PUT object', () => {
    const body = sha256Hex('Welcome to Amazon S3.');
    expect(body).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const p = signatureParts(s3, {
      method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test$file.text', date: may, payloadHash: body,
      headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': body },
    });
    expect(p.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
  it('S3 presigned GET URL', () => {
    const url = presignUrl(s3, { method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', date: may, expiresIn: 86400 });
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
    expect(() => presignUrl(s3, { method: 'GET', url: 'https://x.test/a', date: may, expiresIn: 604801 })).toThrow();
  });
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('r2 driver against a mocked fetch (no network)', () => {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  const fakeR2: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers });
    const path = new URL(url).pathname;
    const res = (status: number, body: Buffer = Buffer.alloc(0), type?: string) => ({
      status, headers: { get: (n: string) => (n === 'content-type' ? type ?? null : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer, text: async () => body.toString('utf8'),
    });
    if (!init.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=TESTKEY/')) return res(403, Buffer.from('<Error><Code>AccessDenied</Code></Error>'));
    if (init.headers['x-amz-content-sha256'] !== sha256Hex(init.body ?? '')) return res(400, Buffer.from('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>'));
    if (init.method === 'PUT') { objects.set(path, { body: init.body!, type: init.headers['content-type']! }); return res(200); }
    if (init.method === 'GET') { const o = objects.get(path); return o ? res(200, o.body, o.type) : res(404, Buffer.from('<Error><Code>NoSuchKey</Code></Error>')); }
    if (init.method === 'DELETE') { objects.delete(path); return res(204); }
    return res(405);
  };
  const cfg = { accountId: '0123456789abcdef0123456789abcdef', bucket: 'wts-files', accessKeyId: 'TESTKEY', secretAccessKey: 'TESTSECRET-never-logged' };
  const store = r2FileStore(cfg, fakeR2, () => new Date('2026-11-06T00:00:00Z'));

  it('put / get / delete with signed requests to the account endpoint', async () => {
    const key = fileKey(A, 'item-image', 'image/png');
    expect(key).toMatch(new RegExp(`^${A}/item-image/[0-9a-f-]{36}\\.png$`));
    await store.put(key, Buffer.from('png-bytes'), 'image/png');
    expect(calls[0]!.url).toBe(`https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/wts-files/${key}`);
    expect(calls[0]!.headers.authorization).toMatch(/\/20261106\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain('TESTSECRET');
    expect(await store.get(key)).toEqual({ body: Buffer.from('png-bytes'), contentType: 'image/png' });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
  it('presigns a short-lived GET without the secret in it', async () => {
    const key = fileKey(A, 'slip', 'image/jpeg');
    const url = (await store.signedUrl(key, 120))!;
    expect(url).toContain(`/wts-files/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=TESTKEY%2F20261106%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261106T000000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=host&X-Amz-Signature=`);
    expect(url).not.toContain('TESTSECRET');
  });
  it('reports a refused request in Thai without the secret', async () => {
    const bad = r2FileStore({ ...cfg, accessKeyId: 'WRONG' }, fakeR2);
    await expect(bad.put(fileKey(A, 'logo', 'image/png'), Buffer.from('x'), 'image/png')).rejects.toThrow(/403 AccessDenied.*ตรวจค่า R2/);
  });
  it('refuses a key of another company', async () => {
    const mine = scopedStore(store, A);
    const theirs = fileKey(B, 'logo', 'image/png');
    await expect(mine.get(theirs)).rejects.toBeInstanceOf(FileScopeError);
    await expect(mine.signedUrl(theirs)).rejects.toBeInstanceOf(FileScopeError);
    await expect(mine.delete(theirs)).rejects.toBeInstanceOf(FileScopeError);
    expect(() => assertKeyScope(`${A}/../${B}/logo/x.png`, A)).toThrow(FileScopeError);
    expect(() => fileKey('not-a-uuid', 'logo', 'image/png')).toThrow();
  });
});

describe('local driver', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wts-files-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('is the default and keeps files in a folder; no signed URL', async () => {
    const store = fileStoreFromEnv({}, dir);
    expect(store.driver).toBe('local');
    const key = fileKey(A, 'logo', 'image/jpeg');
    await store.put(key, Buffer.from('jpeg'), 'image/jpeg');
    expect(await store.get(key)).toEqual({ body: Buffer.from('jpeg'), contentType: 'image/jpeg' });
    expect(await store.signedUrl(key)).toBeNull();
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(localFileStore(dir).get('../../etc/passwd')).rejects.toThrow();
    expect(fileStoreFromEnv({ FILES_DRIVER: 'r2', R2_ACCOUNT_ID: cfgId, R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }, dir).driver).toBe('r2');
    expect(() => fileStoreFromEnv({ FILES_DRIVER: 'r2' }, dir)).toThrow(/R2/);
  });
});
const cfgId = 'abcdefabcdefabcdefabcdefabcdefab';
