import { d, round2 } from './money.js';

/**
 * แพ็กเกจและการใช้งานของลูกค้า (HANDOFF 185 · เจ้าของ 25/11/2569 "แบบ A เอกสาร+ไฟล์")
 * ราคาต่อปี ไม่รวม VAT · จำกัดจำนวนบริษัท ผู้ใช้ เอกสารต่อเดือน พื้นที่ไฟล์ และการอ่านบิลด้วย AI ต่อเดือน
 * ยอดการใช้งานคำนวณสดจากข้อมูลทุกครั้ง (ไม่เก็บยอดสะสม — แนวเดียวกับกฎข้อ 8)
 * เอกสารไม่ถูกหยุดเด็ดขาด (ออกใบกำกับภาษีต้องไม่สะดุด) — เกินแล้วคิดส่วนเกิน · บริษัท/ผู้ใช้ ห้ามเกิน (ตรวจตอนสร้าง)
 * ไฟล์/AI เกิน 100%: ตามค่าของลูกค้า "เตือนและคิดเงินส่วนเกิน" (W ค่าเริ่มต้น) หรือ "หยุด" (S)
 */
export type QuotaKey = 'companies' | 'users' | 'docs' | 'files' | 'ai';
export const QUOTA_KEYS: QuotaKey[] = ['companies', 'users', 'docs', 'files', 'ai'];
export const QUOTA_LABEL: Record<QuotaKey, string> = { companies: 'บริษัท', users: 'ผู้ใช้', docs: 'เอกสารต่อเดือน', files: 'พื้นที่ไฟล์', ai: 'อ่านบิลด้วย AI ต่อเดือน' };
/** นิยาม "เอกสาร" ที่นับ — แสดงบนหน้าจอ */
export const DOCS_DEFINITION = 'เอกสารที่สร้างในเดือนนั้น: เอกสารซื้อ ขาย การเงิน คลัง ทุกชนิด (รวมที่มาจาก API / WTS-POS / WTS-Living / นำเข้า Excel และที่ยกเลิกภายหลัง) + ใบสำคัญที่บันทึกเอง (ไม่นับใบสำคัญที่ระบบสร้างจากเอกสาร ค่าเสื่อม หรือปิดบัญชีสิ้นปี และข้อมูลที่ย้ายมาจาก Express)';
export const WARN_PCT = 80;

/**
 * ผู้จ่ายค่า AI ต่อลูกค้า (HANDOFF 190 · เจ้าของ 25/11/2569 "ให้เลือกว่าใครเป็นคนจ่าย ... ลูกค้าบางรายให้เราเป็นจ่ายให้")
 * C = ลูกค้าจ่ายเอง (ค่าเริ่มต้น): ใช้กุญแจ API ของบริษัท ค่าใช้จ่ายเรียกเก็บกับบัญชี Anthropic ของลูกค้า — ไม่นับโควตา AI ของแพ็กเกจ ไม่คิดส่วนเกิน AI
 * P = WTS จ่ายให้: ใช้กุญแจของผู้ให้บริการ · เพดานดอลลาร์ต่อเดือนรวมทุกบริษัทของลูกค้า · นับโควตา/ส่วนเกิน AI ตามแพ็กเกจ
 */
export type AiPayer = 'C' | 'P';
export const AI_PAYER_TH: Record<AiPayer, string> = { C: 'ลูกค้าจ่ายเอง', P: 'WTS จ่ายให้' };
/** เพดานค่า AI ต่อเดือนเริ่มต้นของลูกค้าที่ WTS จ่ายให้ (ดอลลาร์สหรัฐ — ค่าเริ่มต้นของคอลัมน์ sys_tenant.ai_limit_usd) */
export const PROVIDER_AI_LIMIT_USD = '20';
/** ขีดจำกัดตามผู้จ่ายค่า AI: ลูกค้าจ่ายเอง = ไม่มีโควตา AI (ไม่เตือน ไม่หยุด ไม่คิดส่วนเกิน) */
export function limitsForPayer(l: Limits, payer: AiPayer | string | null | undefined): Limits {
  return payer === 'P' ? l : { ...l, ai: null };
}
/** ใช้ครบเพดานดอลลาร์แล้วหรือยัง (ว่าง = ไม่จำกัด) — ข้อความทศนิยม ไม่ใช้ number กับเงิน */
export function aiCeilingReached(usedUsd: string, limitUsd: string | null | undefined): boolean {
  return limitUsd !== null && limitUsd !== undefined && limitUsd !== '' && d(usedUsd).gte(limitUsd);
}

/** ขีดจำกัด (ว่าง = ไม่จำกัด) — ไฟล์เป็น MB */
export interface Limits { companies: number | null; users: number | null; docs: number | null; file_mb: number | null; ai: number | null }
export interface Usage { companies: number; users: number; docs: number; file_bytes: number; ai: number }
/** อัตราส่วนเกิน (ข้อความทศนิยม — เงินไม่ใช้ number) */
export interface OverageRates { over_company_year: string; over_user_year: string; over_doc: string; over_file_gb_month: string; over_ai: string }
export interface PackageLimits { max_companies: number | null; max_users: number | null; docs_per_month: number | null; file_quota_mb: number | null; ai_per_month: number | null }
export type TenantOverrides = Partial<PackageLimits>;
export type Level = 'none' | 'ok' | 'warn' | 'over';

const MB = 1024 * 1024, GB = 1024 * MB;

/** ขีดจำกัดที่ใช้จริง: ค่าของลูกค้า (ถ้าตั้ง) ทับค่าของแพ็กเกจ · ไม่มีแพ็กเกจและไม่ได้ตั้ง = ไม่จำกัด */
export function effectiveLimits(pkg: PackageLimits | null, t: TenantOverrides): Limits {
  const pick = (k: keyof PackageLimits) => (t[k] ?? null) !== null ? t[k]! : pkg ? pkg[k] : null;
  return { companies: pick('max_companies'), users: pick('max_users'), docs: pick('docs_per_month'), file_mb: pick('file_quota_mb'), ai: pick('ai_per_month') };
}

/** ร้อยละที่ใช้ (ปัดลงเป็นจำนวนเต็ม · ขีดจำกัดว่าง = null) */
export function usagePct(used: number, limit: number | null): number | null {
  if (limit === null || limit === undefined) return null;
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.floor((used * 100) / limit);
}
export function usageLevel(pct: number | null): Level {
  if (pct === null) return 'none';
  return pct >= 100 ? 'over' : pct >= WARN_PCT ? 'warn' : 'ok';
}

export interface QuotaRow { key: QuotaKey; used: number; limit: number | null; pct: number | null; level: Level }
/** แถวแสดงผล — ไฟล์: used/limit เป็น MB (ทศนิยม 1 ตำแหน่ง) */
export function quotaRows(l: Limits, u: Usage): QuotaRow[] {
  const fileMb = Math.round((u.file_bytes / MB) * 10) / 10;
  const row = (key: QuotaKey, used: number, limit: number | null, exactUsed = used, exactLimit = limit): QuotaRow => {
    const pct = key === 'files' && exactLimit !== null ? usagePct(u.file_bytes, exactLimit * MB) : usagePct(exactUsed, exactLimit);
    // บริษัท/ผู้ใช้ = เพดานที่เพิ่มเกินไม่ได้: ใช้ครบพอดีเป็นเรื่องปกติ (ไม่เตือน) — เตือนเฉพาะเกินจริง (ผู้ให้บริการลดเพดานภายหลัง)
    if (key === 'companies' || key === 'users') return { key, used, limit, pct, level: limit === null ? 'none' : used > limit ? 'over' : 'ok' };
    return { key, used, limit, pct, level: usageLevel(pct) };
  };
  return [row('companies', u.companies, l.companies), row('users', u.users, l.users), row('docs', u.docs, l.docs), row('files', fileMb, l.file_mb), row('ai', u.ai, l.ai)];
}
/** ระดับที่แย่ที่สุด (แถบเตือน) */
export function worstLevel(rows: QuotaRow[]): Level {
  return rows.some((r) => r.level === 'over') ? 'over' : rows.some((r) => r.level === 'warn') ? 'warn' : rows.some((r) => r.level === 'ok') ? 'ok' : 'none';
}

/** ไฟล์/AI เกินแล้ว (หยุดเมื่อลูกค้าตั้ง "หยุด") — addBytes = ไฟล์ที่กำลังจะเพิ่ม */
export function quotaBlocked(key: 'files' | 'ai', l: Limits, u: Usage, addBytes = 0): boolean {
  if (key === 'files') return l.file_mb !== null && u.file_bytes + addBytes > l.file_mb * MB;
  return l.ai !== null && u.ai >= l.ai;
}

export interface OverageLine { key: QuotaKey; label: string; over: string; unit: string; rate: string; amount: string; note: string }
/**
 * ค่าใช้ส่วนเกินของเดือน (ไม่รวม VAT):
 * - บริษัท/ผู้ใช้: ที่ใช้จริงเกินจำนวนในแพ็กเกจ (ผู้ให้บริการขยายให้รายลูกค้า) × อัตราต่อปี ÷ 12
 * - เอกสาร: เกินขีดจำกัดของเดือน × อัตราต่อใบ · AI: เกิน × อัตราต่อบิล
 * - ไฟล์: ส่วนที่เกิน (GB ทศนิยม 2 ตำแหน่ง) × อัตราต่อ GB ต่อเดือน
 * ไม่มีแพ็กเกจ = ไม่คิดส่วนเกิน
 */
export function overageLines(pkg: PackageLimits | null, l: Limits, u: Usage, r: OverageRates | null): { lines: OverageLine[]; total: string } {
  if (!pkg || !r) return { lines: [], total: '0.00' };
  const lines: OverageLine[] = [];
  const add = (key: QuotaKey, over: ReturnType<typeof d>, unit: string, rate: string, amount: ReturnType<typeof d>, note: string) => {
    if (over.gt(0)) lines.push({ key, label: QUOTA_LABEL[key], over: over.toString(), unit, rate: d(rate).toFixed(2), amount: round2(amount).toFixed(2), note });
  };
  const perMonth = (n: number, rate: string) => d(n).times(rate).div(12);
  if (pkg.max_companies !== null) { const n = Math.max(0, u.companies - pkg.max_companies); add('companies', d(n), 'บริษัท', r.over_company_year, perMonth(n, r.over_company_year), 'อัตราต่อปี ÷ 12'); }
  if (pkg.max_users !== null) { const n = Math.max(0, u.users - pkg.max_users); add('users', d(n), 'คน', r.over_user_year, perMonth(n, r.over_user_year), 'อัตราต่อปี ÷ 12'); }
  if (l.docs !== null) { const n = Math.max(0, u.docs - l.docs); add('docs', d(n), 'ใบ', r.over_doc, d(n).times(r.over_doc), 'ต่อใบ'); }
  if (l.file_mb !== null) {
    const overGb = round2(d(Math.max(0, u.file_bytes - l.file_mb * MB)).div(GB));
    add('files', overGb, 'GB', r.over_file_gb_month, overGb.times(r.over_file_gb_month), 'ต่อ GB ต่อเดือน');
  }
  if (l.ai !== null) { const n = Math.max(0, u.ai - l.ai); add('ai', d(n), 'บิล', r.over_ai, d(n).times(r.over_ai), 'ต่อบิล'); }
  return { lines, total: lines.reduce((s, x) => s.plus(x.amount), d(0)).toFixed(2) };
}

/** เดือน 'YYYY-MM' → ช่วงเวลา [ต้นเดือน, ต้นเดือนถัดไป) เวลาไทย (ISO มี +07:00) */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const p = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${p(m)}-01T00:00:00+07:00`, to: `${ny}-${p(nm)}-01T00:00:00+07:00` };
}
/** เดือนปัจจุบันตามเวลาไทย */
export const thisMonthTh = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 7);
