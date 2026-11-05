import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { deriveSubkey } from './secret.js';

/**
 * บัตรผ่าน Hub (docs/17 ข้อ 5.8 · B6.1) — JWT อายุสั้น ลงนาม EdDSA (Ed25519) ใช้แค่ node:crypto ไม่ต้องติดตั้งแพ็กเกจ
 * กุญแจลงนามได้จากกุญแจหลักของเครื่องแม่ข่าย (secret.ts) — ไม่เก็บกุญแจลับในฐานข้อมูล · โปรแกรมอื่นตรวจด้วย /.well-known/jwks.json
 * อายุ 2 นาที ใช้ได้ครั้งเดียว (ผู้รับจด jti) · audience ต่อโปรแกรม (wts-pos …)
 */
export const SSO_TTL_SECONDS = 120;
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export type Jwk = { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; alg: 'EdDSA'; use: 'sig' };
let keys: { priv: KeyObject; jwk: Jwk } | null = null;
function ssoKeys() {
  if (keys) return keys;
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, deriveSubkey('hub-sso-ed25519-v1')]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv).export({ format: 'jwk' }) as { x: string };
  const kid = createHash('sha256').update(pub.x).digest('base64url').slice(0, 16);
  keys = { priv, jwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x, kid, alg: 'EdDSA', use: 'sig' } };
  return keys;
}

export const jwks = () => ({ keys: [ssoKeys().jwk] });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export type SsoClaims = {
  iss: string; aud: string; sub: string; iat: number; exp: number; jti: string;
  name: string; preferred_username: string;
  buddy: {
    tenant: { id: string; code: string; name: string } | null;
    company: { id: string; code: string; name_th: string; tax_id: string | null };
    branch: { id: string; code: string; name: string } | null;
    admin: boolean; platform: boolean;
  };
};

export function signSsoToken(c: Omit<SsoClaims, 'iat' | 'exp' | 'jti'>, now = Date.now()): { token: string; claims: SsoClaims } {
  const { priv, jwk } = ssoKeys();
  const iat = Math.floor(now / 1000);
  const claims: SsoClaims = { ...c, iat, exp: iat + SSO_TTL_SECONDS, jti: randomUUID() };
  const head = `${b64({ alg: 'EdDSA', typ: 'JWT', kid: jwk.kid })}.${b64(claims)}`;
  return { token: `${head}.${sign(null, Buffer.from(head), priv).toString('base64url')}`, claims };
}

/**
 * ตรวจบัตรผ่าน — ตัวอย่างอ้างอิงสำหรับโปรแกรมผู้รับ (docs/07 ข้อ Hub) และชุดทดสอบ
 * ผู้รับต้องจด jti ที่ใช้แล้วจนหมดอายุ (กันใช้ซ้ำ) เอง
 */
export function verifySsoToken(token: string, set: { keys: Jwk[] }, audience: string, now = Date.now(), skewSeconds = 60): SsoClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('บัตรผ่านไม่ถูกรูปแบบ');
  const [h, p, s] = parts as [string, string, string];
  const head = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string; kid?: string };
  if (head.alg !== 'EdDSA') throw new Error('บัตรผ่านใช้วิธีลงนามที่ไม่รองรับ');
  const jwk = set.keys.find((k) => k.kid === head.kid);
  if (!jwk) throw new Error('ไม่รู้จักกุญแจที่ลงนามบัตรผ่าน');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  if (!verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('ลายเซ็นบัตรผ่านไม่ถูกต้อง');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString()) as SsoClaims;
  const t = Math.floor(now / 1000);
  if (c.aud !== audience) throw new Error('บัตรผ่านนี้ออกให้โปรแกรมอื่น');
  if (!(c.exp + skewSeconds > t)) throw new Error('บัตรผ่านหมดอายุ — กดเปิดจาก Hub ใหม่');
  if (c.iat - skewSeconds > t) throw new Error('เวลาในบัตรผ่านไม่ถูกต้อง — ตรวจนาฬิกาเครื่อง');
  return c;
}
