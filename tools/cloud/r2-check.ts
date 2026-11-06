// ตรวจที่เก็บไฟล์ Cloudflare R2 (docs/20 ข้อ 9) — pg-check.mjs เรียกไฟล์นี้ด้วย tsx เมื่อมีค่า R2_* ใน .data/cloud-s0.env
// put → get (เทียบทุกไบต์) → ที่อยู่แบบเซ็น (เปิดได้โดยไม่ใส่กุญแจ) → เปิดตรงไม่เซ็น (ต้องถูกปฏิเสธ = bucket ไม่สาธารณะ) → delete → get = ไม่พบ
// ใช้ตัวเก็บ r2 ตัวเดียวกับ server (apps/server/src/storage) · พิมพ์ผลเป็น JSON บรรทัดเดียว ไม่มีความลับ
// R2_CHECK_MOCK=1 = ซ้อมกับ R2 จำลองในเครื่อง (HTTP ที่ตรวจลายเซ็น SigV4 จริง) — ใช้ตอน --local-pg / --sim-supabase
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileKey, r2FileStore, type R2Config } from '../../apps/server/src/storage/files.js';
import { presignUrl, sha256Hex, signatureParts } from '../../apps/server/src/storage/sigv4.js';

type Step = { step: string; ok: boolean; ms: number; detail?: string };

async function mockR2(cfg: R2Config) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const cred = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: 'auto', service: 's3' };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const deny = (code: number, c: string) => { res.writeHead(code, { 'content-type': 'application/xml' }); res.end(`<Error><Code>${c}</Code></Error>`); };
    // ตรวจลายเซ็นแบบ R2: header Authorization หรือ query X-Amz-Signature
    const sig = url.searchParams.get('X-Amz-Signature');
    if (sig) {
      const q = new URL(url); q.searchParams.delete('X-Amz-Signature');
      const expect = presignUrl(cred, { method: req.method!, url: `${url.origin}${url.pathname}`, date: new Date(`${url.searchParams.get('X-Amz-Date')!.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')}`), expiresIn: Number(url.searchParams.get('X-Amz-Expires')) });
      if (!expect.endsWith(`X-Amz-Signature=${sig}`)) return deny(403, 'SignatureDoesNotMatch');
    } else {
      const auth = String(req.headers.authorization ?? '');
      const m = /SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
      if (!m) return deny(403, 'AccessDenied');
      const headers: Record<string, string> = {};
      for (const h of m[1]!.split(';')) if (h !== 'host') headers[h] = String(req.headers[h]);
      const d = String(req.headers['x-amz-date']).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
      const p = signatureParts(cred, { method: req.method!, url: url.toString(), headers, date: new Date(d), payloadHash: String(req.headers['x-amz-content-sha256']) });
      if (p.signature !== m[2] || sha256Hex(body) !== req.headers['x-amz-content-sha256']) return deny(403, 'SignatureDoesNotMatch');
    }
    const key = decodeURIComponent(url.pathname);
    if (req.method === 'PUT') { objects.set(key, { body, type: String(req.headers['content-type']) }); res.writeHead(200); return res.end(); }
    if (req.method === 'GET') { const o = objects.get(key); if (!o) return deny(404, 'NoSuchKey'); res.writeHead(200, { 'content-type': o.type }); return res.end(o.body); }
    if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
    return deny(405, 'MethodNotAllowed');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

async function main() {
  const mock = process.env.R2_CHECK_MOCK === '1';
  const cfg: R2Config = mock
    ? { accountId: '0'.repeat(32), bucket: 'wts-s0-mock', accessKeyId: 'MOCKKEY', secretAccessKey: `mock-${randomUUID()}` }
    : { accountId: process.env.R2_ACCOUNT_ID ?? '', bucket: process.env.R2_BUCKET ?? '', accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '' };
  const m = mock ? await mockR2(cfg) : null;
  const store = r2FileStore({ ...cfg, endpoint: m?.endpoint });
  const steps: Step[] = [];
  const step = async (name: string, fn: () => Promise<string | void>) => {
    const t = Date.now();
    try { const d = await fn(); steps.push({ step: name, ok: true, ms: Date.now() - t, ...(d ? { detail: d } : {}) }); return true; }
    catch (e) { steps.push({ step: name, ok: false, ms: Date.now() - t, detail: (e as Error).message }); return false; }
  };
  // key ทดสอบ: บริษัทสุ่ม (ไม่ชนข้อมูลจริง) · ชนิด s0-check
  const key = fileKey(randomUUID(), 's0-check', 'image/png');
  const body = Buffer.from(`WTS S0 R2 check ${new Date().toISOString()} ${randomUUID()}`);
  let ok = await step('put', () => store.put(key, body, 'image/png'));
  if (ok) {
    await step('get', async () => {
      const f = await store.get(key);
      if (!f || !f.body.equals(body)) throw new Error('ได้ไฟล์ไม่ตรงกับที่อัปโหลด');
      return `${f.body.length} ไบต์ ตรงทุกไบต์ · ${f.contentType}`;
    });
    await step('presigned GET (5 นาที)', async () => {
      const url = (await store.signedUrl(key, 300))!;
      const r = await fetch(url);
      const got = Buffer.from(await r.arrayBuffer());
      if (r.status !== 200 || !got.equals(body)) throw new Error(`เปิดที่อยู่แบบเซ็นได้ ${r.status}`);
      return 'เปิดได้โดยไม่ต้องใช้กุญแจ';
    });
    await step('unsigned GET ต้องถูกปฏิเสธ (bucket ไม่สาธารณะ)', async () => {
      const base = m?.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`;
      const r = await fetch(`${base}/${cfg.bucket}/${key}`);
      if (r.status === 200) throw new Error('เปิดได้โดยไม่เซ็น — bucket เปิดสาธารณะอยู่ ให้ปิด');
      return `ปฏิเสธ ${r.status}`;
    });
    ok = await step('delete', () => store.delete(key));
    if (ok) await step('get หลังลบ = ไม่พบ', async () => { if (await store.get(key)) throw new Error('ยังพบไฟล์หลังลบ'); });
  }
  await m?.close();
  process.stdout.write(`R2CHECK ${JSON.stringify({ mock, steps })}\n`);
  process.exit(steps.every((s) => s.ok) ? 0 : 2);
}
main().catch((e) => { process.stdout.write(`R2CHECK ${JSON.stringify({ steps: [{ step: 'start', ok: false, ms: 0, detail: (e as Error).message }] })}\n`); process.exit(2); });
