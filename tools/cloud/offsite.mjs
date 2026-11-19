// สำเนาสำรองนอกเครื่อง (HANDOFF 146 · เจ้าของ 19/11/2569 "ทำทั้ง 4 ข้อ") — ใช้จาก tools/cloud/backup.mjs
//
// ทุกไฟล์ของชุดสำรองเข้ารหัสด้วยกุญแจของเจ้าของ (.data/backup-offsite.key · 32 ไบต์ · AES-256-GCM) ก่อนออกจากโฟลเดอร์หลัก
// ที่เก็บ (ตั้งอย่างใดอย่างหนึ่งหรือทั้งสอง):
//   1) โฟลเดอร์ที่สอง  — .data/backup-offsite.json { "folder": "D:\\WTS-Backup-offsite" } (ไดรฟ์ภายนอก / โฟลเดอร์ OneDrive ที่เจ้าของเลือก)
//   2) Cloudflare R2 bucket แยก — BACKUP_R2_BUCKET · BACKUP_R2_ACCESS_KEY_ID · BACKUP_R2_SECRET_ACCESS_KEY · R2_ACCOUNT_ID ใน .data/cloud-prod.env
//      (ใส่ด้วย tools\cloud\set-r2-keys.ps1 ขั้น "สำรองนอกเครื่อง") · ชื่อ object <prefix>/<ชุด>/<ไฟล์>.enc
// เก็บนอกเครื่อง 90 วัน (ลบชุดที่เก่ากว่า หลังชุดใหม่ขึ้นครบและตรวจแล้ว)
// ตรวจหลังเขียน: อ่านกลับ → ถอดรหัส → sha256 ต้องเท่าไฟล์ต้นฉบับทุกไฟล์
// ความลับ (กุญแจ รหัส R2) ไม่พิมพ์ลงจอ/log
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OFFSITE_KEEP_DAYS = 90;
const MAGIC = Buffer.from('WTSOFFSITE1');
const FOLDER_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/;

/* ---------------------------------------------------------------- กุญแจ + เข้ารหัส */
export function loadKey(file) {
  if (!existsSync(file)) return null;
  const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error(`กุญแจสำรองนอกเครื่อง ${file} ไม่ถูกต้อง (ต้องเป็น 32 ไบต์ base64)`);
  return k;
}
export function newKeyFile(file) {
  if (existsSync(file)) throw new Error(`มีกุญแจอยู่แล้วที่ ${file} — ไม่สร้างทับ (กุญแจเดิมยังใช้เปิดสำเนาเก่า)`);
  writeFileSync(file, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  return loadKey(file);
}
/** รหัสกุญแจ (ไม่ใช่ความลับ) — ไว้ตรวจว่ากุญแจที่ใช้เปิดตรงกับที่ใช้เข้ารหัส */
export const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 12);
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export function encrypt(key, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
export function decrypt(key, buf) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('ไม่ใช่ไฟล์สำรองนอกเครื่อง (.enc) ของ WTS');
  let o = MAGIC.length;
  const iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(o)), d.final()]); } catch { throw new Error('ถอดรหัสไม่ได้ — กุญแจไม่ตรงกับที่ใช้เข้ารหัส หรือไฟล์เสียหาย'); }
}

/* ---------------------------------------------------------------- R2 (S3 API · SigV4 แบบเดียวกับ apps/server/src/storage/sigv4.ts) */
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const amzDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function signV4({ accessKeyId, secretAccessKey, region = 'auto', service = 's3' }, { method, url, headers = {}, payloadHash, date = new Date() }) {
  const u = new URL(url);
  const stamp = amzDate(date), day = stamp.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
  const h = { host: u.host, 'x-amz-date': stamp, 'x-amz-content-sha256': payloadHash, ...headers };
  const list = Object.entries(h).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signed = list.map(([k]) => k).join(';');
  const cq = [...u.searchParams.entries()].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const cu = u.pathname.split('/').map((s) => uriEncode(decodeURIComponent(s))).join('/') || '/';
  const creq = [method, cu, cq, list.map(([k, v]) => `${k}:${v}\n`).join(''), signed, payloadHash].join('\n');
  const sts = ['AWS4-HMAC-SHA256', stamp, scope, sha256(Buffer.from(creq))].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(sts, 'utf8').digest('hex');
  const out = Object.fromEntries(list.filter(([k]) => k !== 'host'));
  out.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return out;
}
export function r2Client(cfg, fetchImpl = fetch) {
  const base = (cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '');
  const objUrl = (key) => `${base}/${cfg.bucket}/${key.split('/').map(uriEncode).join('/')}`;
  const req = async (method, url, body) => {
    const payloadHash = body ? sha256(body) : sha256(Buffer.alloc(0));
    const headers = signV4(cfg, { method, url, payloadHash, headers: body ? { 'content-type': 'application/octet-stream' } : {} });
    const r = await fetchImpl(url, { method, headers, body });
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`R2 ${method} ตอบ ${r.status}`);
    return r;
  };
  return {
    put: async (key, body) => { await req('PUT', objUrl(key), body); },
    get: async (key) => Buffer.from(await (await req('GET', objUrl(key))).arrayBuffer()),
    del: async (key) => { await req('DELETE', objUrl(key)); },
    /** ListObjectsV2 ทีละหน้า → ชื่อ object ทั้งหมดใต้ prefix */
    list: async (prefix) => {
      const keys = [];
      let token = null;
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
        const xml = await (await req('GET', `${base}/${cfg.bucket}?${q}`)).text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
      } while (token);
      return keys;
    },
  };
}

/* ---------------------------------------------------------------- ค่าตั้ง */
/** อ่านค่าตั้งสำเนานอกเครื่อง — ไม่มีอะไรตั้ง = { targets: [] } */
export function offsiteConfig(root, env = {}) {
  const file = join(root, '.data/backup-offsite.json');
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const targets = [];
  if (cfg.folder) targets.push({ kind: 'folder', label: `โฟลเดอร์ ${cfg.folder}`, folder: cfg.folder });
  if (env.BACKUP_R2_BUCKET && env.BACKUP_R2_ACCESS_KEY_ID && env.BACKUP_R2_SECRET_ACCESS_KEY && (env.R2_ACCOUNT_ID || env.BACKUP_R2_ENDPOINT))
    targets.push({ kind: 'r2', label: `R2 ${env.BACKUP_R2_BUCKET}/${cfg.r2_prefix ?? 'cloud-backup'}`, prefix: cfg.r2_prefix ?? 'cloud-backup',
      r2: { accountId: env.R2_ACCOUNT_ID, endpoint: env.BACKUP_R2_ENDPOINT, bucket: env.BACKUP_R2_BUCKET, accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_R2_SECRET_ACCESS_KEY } });
  return { keyFile: join(root, cfg.key_file ?? '.data/backup-offsite.key'), keepDays: Number(cfg.keep_days ?? OFFSITE_KEEP_DAYS), targets, secrets: [env.BACKUP_R2_ACCESS_KEY_ID, env.BACKUP_R2_SECRET_ACCESS_KEY].filter(Boolean) };
}

const oldSets = (names, keepDays, now = Date.now()) => {
  const sets = [...new Set(names)].filter((n) => FOLDER_RE.test(n)).sort();
  return sets.slice(0, -1).filter((n) => { const [, y, mo, d] = FOLDER_RE.exec(n); return now - Date.UTC(Number(y) - 543, Number(mo) - 1, Number(d)) > keepDays * 86_400_000; });
};

/**
 * ส่งชุดสำรอง (โฟลเดอร์ dir) ไปทุกที่เก็บนอกเครื่องที่ตั้งไว้ → [{ label, ok, message }]
 * ข้อมูลแต่ละไฟล์: ถอดรหัสกลับได้และ sha256 ตรงกับต้นฉบับ (offsite.json บอก sha256 ของต้นฉบับ + รหัสกุญแจ)
 */
export async function sendOffsite(dir, cfg, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!cfg.targets.length) return [];
  const key = loadKey(cfg.keyFile);
  if (!key) return cfg.targets.map((t) => ({ label: t.label, ok: false, message: `ไม่พบกุญแจ ${cfg.keyFile} — รัน node tools/cloud/setup-offsite.mjs ก่อน` }));
  const set = dir.split(/[\\/]/).filter(Boolean).pop();
  const names = readdirSync(dir).filter((n) => /\.(dump|json)$/.test(n)).sort();
  const files = names.map((n) => { const plain = readFileSync(join(dir, n)); return { n, plain, sum: sha256(plain), enc: encrypt(key, plain) }; });
  const index = Buffer.from(`${JSON.stringify({ format: 'wts-offsite', version: 1, set, key_id: keyId(key), created_at: new Date(now).toISOString(), files: Object.fromEntries(files.map((f) => [f.n, { bytes: f.plain.length, sha256: f.sum }])) }, null, 2)}\n`);
  const results = [];
  for (const t of cfg.targets) {
    try {
      let removed = [];
      if (t.kind === 'folder') {
        if (!existsSync(t.folder)) throw new Error(`ไม่พบโฟลเดอร์ ${t.folder} (ไดรฟ์ไม่ได้เสียบ/ชื่อเปลี่ยน?)`);
        const out = join(t.folder, set);
        mkdirSync(out, { recursive: true });
        for (const f of files) writeFileSync(join(out, `${f.n}.enc`), f.enc);
        writeFileSync(join(out, 'offsite.json'), index);
        for (const f of files) if (sha256(decrypt(key, readFileSync(join(out, `${f.n}.enc`)))) !== f.sum) throw new Error(`อ่านกลับแล้วไม่ตรง: ${f.n}`);
        for (const n of oldSets(readdirSync(t.folder), cfg.keepDays, now)) { rmSync(join(t.folder, n), { recursive: true, force: true }); removed.push(n); }
      } else {
        const r2 = r2Client(t.r2, fetchImpl);
        for (const f of files) await r2.put(`${t.prefix}/${set}/${f.n}.enc`, f.enc);
        await r2.put(`${t.prefix}/${set}/offsite.json`, index);
        for (const f of files) if (sha256(decrypt(key, await r2.get(`${t.prefix}/${set}/${f.n}.enc`))) !== f.sum) throw new Error(`อ่านกลับแล้วไม่ตรง: ${f.n}`);
        const all = await r2.list(`${t.prefix}/`);
        const bySet = (k) => k.slice(t.prefix.length + 1).split('/')[0];
        const old = new Set(oldSets(all.map(bySet), cfg.keepDays, now));
        for (const k of all) if (old.has(bySet(k))) await r2.del(k);
        removed = [...old];
      }
      results.push({ label: t.label, ok: true, message: `${files.length} ไฟล์ เข้ารหัสแล้ว อ่านกลับตรง${removed.length ? ` · ลบชุดเก่ากว่า ${cfg.keepDays} วัน ${removed.length}` : ''}` });
    } catch (e) {
      results.push({ label: t.label, ok: false, message: e.message });
    }
  }
  return results;
}

/** นำสำเนานอกเครื่องกลับมาเป็นชุดปกติ (ถอดรหัส) → โฟลเดอร์ out (ใช้ backup.mjs --verify <out> ต่อได้) */
export async function fetchOffsite({ source, out, key, r2 = null, prefix = 'cloud-backup', fetchImpl = fetch }) {
  mkdirSync(out, { recursive: true });
  let read;
  if (r2) { const c = r2Client(r2, fetchImpl); read = (n) => c.get(`${prefix}/${source}/${n}`); }
  else read = async (n) => readFileSync(join(source, n));
  const index = JSON.parse((await read('offsite.json')).toString('utf8'));
  if (index.key_id !== keyId(key)) throw new Error(`กุญแจไม่ตรงกับชุดนี้ (ชุดใช้กุญแจรหัส ${index.key_id} · กุญแจที่มีรหัส ${keyId(key)})`);
  for (const [n, info] of Object.entries(index.files)) {
    const plain = decrypt(key, await read(`${n}.enc`));
    if (sha256(plain) !== info.sha256) throw new Error(`ไฟล์ ${n} ไม่ตรงกับตอนสำรอง`);
    writeFileSync(join(out, n), plain);
  }
  return { set: index.set, files: Object.keys(index.files).length };
}
