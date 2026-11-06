/**
 * AWS Signature Version 4 ด้วย node:crypto (ไม่ใช้ AWS SDK) — ใช้กับ Cloudflare R2 ซึ่งรับ S3 API (region "auto", service "s3")
 * ทดสอบกับชุดตัวอย่างที่ AWS เผยแพร่ (test/storage.test.ts) · ห้ามพิมพ์ secret / ลายเซ็นลง log
 * ไฟล์นี้เหมือนกันทั้ง Buddy · WTS-POS · WTS-Living (docs/20 ข้อ 9) — แก้ที่หนึ่งให้แก้ทุกที่
 */
import { createHash, createHmac } from 'node:crypto';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export const sha256Hex = (data: string | Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986: เข้ารหัสทุกตัวยกเว้น A-Z a-z 0-9 - _ . ~ */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 20150830T123600Z */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function signingKey(c: SigV4Credentials, day: string) {
  return hmac(hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, day), c.region), c.service), 'aws4_request');
}

/** path แบบ S3: เข้ารหัสแต่ละส่วนครั้งเดียว ไม่ยุบ ./.. */
function canonicalUri(pathname: string): string {
  return pathname.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/') || '/';
}

function canonicalQuery(params: Array<[string, string]>): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function canonicalHeaders(headers: Record<string, string>) {
  const list = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { text: list.map(([k, v]) => `${k}:${v}\n`).join(''), signed: list.map(([k]) => k).join(';') };
}

export interface SignInput {
  method: string;
  url: string;
  /** header ที่ต้องเซ็น (host ใส่ให้เองจาก url ถ้าไม่มี) */
  headers?: Record<string, string>;
  /** sha256 ของเนื้อหา (hex) หรือ 'UNSIGNED-PAYLOAD' — ค่าเริ่มต้น = sha256 ของเนื้อหาว่าง */
  payloadHash?: string;
  date: Date;
}

/** คำนวณลายเซ็น (ใช้ภายใน + ทดสอบ) */
export function signatureParts(c: SigV4Credentials, input: SignInput, extraQuery: Array<[string, string]> = []) {
  const u = new URL(input.url);
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${c.region}/${c.service}/aws4_request`;
  const headers: Record<string, string> = { host: u.host, ...(input.headers ?? {}) };
  const ch = canonicalHeaders(headers);
  const query: Array<[string, string]> = [...u.searchParams.entries(), ...extraQuery];
  const creq = [input.method.toUpperCase(), canonicalUri(u.pathname), canonicalQuery(query), ch.text, ch.signed, input.payloadHash ?? sha256Hex('')].join('\n');
  const sts = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(creq)].join('\n');
  const signature = createHmac('sha256', signingKey(c, day)).update(sts, 'utf8').digest('hex');
  return { stamp, scope, signedHeaders: ch.signed, canonicalRequest: creq, stringToSign: sts, signature };
}

/** เซ็นคำขอแบบ header Authorization — คืน header ที่ต้องส่ง (รวม x-amz-date ถ้าผู้เรียกไม่ได้ใส่ date เอง) */
export function signRequest(c: SigV4Credentials, input: SignInput): Record<string, string> {
  const headers = { ...(input.headers ?? {}) };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'x-amz-date' || k.toLowerCase() === 'date')) headers['x-amz-date'] = amzDate(input.date);
  const p = signatureParts(c, { ...input, headers });
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${p.scope}, SignedHeaders=${p.signedHeaders}, Signature=${p.signature}` };
}

/** ที่อยู่แบบเซ็นล่วงหน้า (query string) — อายุ expiresIn วินาที (สูงสุด 7 วันตาม S3) */
export function presignUrl(c: SigV4Credentials, input: Omit<SignInput, 'payloadHash'> & { expiresIn: number }): string {
  if (!(input.expiresIn >= 1 && input.expiresIn <= 604800)) throw new Error('อายุที่อยู่แบบเซ็นต้องอยู่ระหว่าง 1 วินาทีถึง 7 วัน');
  const stamp = amzDate(input.date);
  const scope = `${stamp.slice(0, 8)}/${c.region}/${c.service}/aws4_request`;
  const signedNames = canonicalHeaders({ host: new URL(input.url).host, ...(input.headers ?? {}) }).signed;
  const q: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${c.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', signedNames],
  ];
  const p = signatureParts(c, { ...input, payloadHash: 'UNSIGNED-PAYLOAD' }, q);
  const u = new URL(input.url);
  const all = canonicalQuery([...u.searchParams.entries(), ...q]);
  return `${u.origin}${canonicalUri(u.pathname)}?${all}&X-Amz-Signature=${p.signature}`;
}
