import type { FastifyInstance, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { sql } from 'kysely';
import { z } from 'zod';
import { AI_BILL_TARGETS, AI_BUSINESS_TYPES, AI_MODELS, aiCost, aiModelOf, aiRequestOptions, type AiModelId, BILL_SCHEMA, buyerTaxCheck, BILL_SYSTEM_PROMPT, BILL_SYSTEM_PROMPT_OTHER, BILL_SYSTEM_PROMPT_SALES, aiBillSide, checkTaxId, d, normalizeBill, SUGGEST_SCHEMA, SUGGEST_SYSTEM_PROMPT, suggestPrompt, textSim, type BillDraft, type RawBill, type SuggestCandidate } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';
import { decryptSecret, encryptSecret } from '../secret.js';

/**
 * AI อ่านบิลด้วย Claude (T7.7) — เจ้าของเลือก Claude (Anthropic) · กุญแจ API ของบริษัทใส่เองที่หน้าตั้งค่า (เข้ารหัสเก็บ ไม่ส่งกลับหน้าจอ)
 * เพดานค่าใช้จ่ายต่อเดือน (ดอลลาร์สหรัฐ คิดจากโทเคนจริง) ตรวจก่อนเรียกทุกครั้ง · ผลเป็นร่างให้ผู้ใช้ตรวจก่อนบันทึกเสมอ
 */
const SECRET = 'ANTHROPIC_KEY';
const LIMIT_KEY = 'ai.monthly_limit_usd';
/** รุ่น Claude ของบริษัท (HANDOFF 166) — ไม่ตั้ง = Haiku 5.5 (ถูกที่สุด) */
const MODEL_KEY = 'ai.model';
const DEFAULT_LIMIT = 20;
const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
const MAX_BYTES = 10 * 1024 * 1024;

/** ตัวสร้าง client (ชุดทดสอบแทนที่ด้วยของจำลอง — ไม่เรียก API จริง) */
type AiClient = Pick<Anthropic, 'beta'>;
let makeClient: (apiKey: string) => AiClient = (apiKey) => new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
export function setAiClientFactory(f: (apiKey: string) => AiClient) { makeClient = f; }

async function apiKeyOf(db: Db, companyId: string) {
  const r = await db.selectFrom('sys_secret').select(['value_enc', 'hint']).where('company_id', '=', companyId).where('code', '=', SECRET).where('deleted_at', 'is', null).executeTakeFirst();
  return r ? { key: decryptSecret(r.value_enc), hint: r.hint } : null;
}
async function limitOf(db: Db, companyId: string): Promise<number | null> {
  const v = (await companySettings(db, companyId))[LIMIT_KEY];
  return v === undefined ? DEFAULT_LIMIT : v === null || v === '' ? null : Number(v);
}
async function monthUsage(db: Db, companyId: string) {
  const r = (await sql<{ cost: string; n: number }>`SELECT coalesce(sum(cost_usd), 0)::text AS cost, count(*) FILTER (WHERE status = 'OK' AND purpose = 'BILL')::int AS n FROM sys_ai_usage
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())`.execute(db)).rows[0]!;
  return { cost: d(r.cost), count: r.n };
}
async function modelOf(db: Db, companyId: string): Promise<AiModelId> {
  return aiModelOf((await companySettings(db, companyId))[MODEL_KEY]);
}
async function status(db: Db, companyId: string) {
  const [k, limit, u] = await Promise.all([apiKeyOf(db, companyId), limitOf(db, companyId), monthUsage(db, companyId)]);
  const st = await companySettings(db, companyId);
  return { model: aiModelOf(st[MODEL_KEY]), has_key: !!k?.key, key_hint: k?.hint ?? null, key_broken: !!k && !k.key, monthly_limit_usd: limit, month_cost_usd: u.cost.toFixed(4), month_count: u.count,
    available: !!k?.key && (limit === null || u.cost.lt(limit)), business_type: (st['ai.business_type'] as string | null) ?? null, guidance: (st['ai.guidance'] as string | null) ?? null };
}

async function record(db: Db, a: AuthContext & { companyId: string }, v: { model?: string | null; usage?: Anthropic.Beta.BetaUsage | null; cost?: string; status: 'OK' | 'ERROR' | 'REFUSED'; file_name: string; file_size: number; message?: string | null; purpose?: 'BILL' | 'SUGGEST' | 'MAP' }) {
  await db.insertInto('sys_ai_usage').values({
    company_id: a.companyId, user_id: a.userId, purpose: v.purpose ?? 'BILL', model: v.model ?? null,
    input_tokens: v.usage?.input_tokens ?? 0, output_tokens: v.usage?.output_tokens ?? 0,
    cache_read_tokens: v.usage?.cache_read_input_tokens ?? 0, cache_write_tokens: v.usage?.cache_creation_input_tokens ?? 0,
    cost_usd: v.cost ?? '0', status: v.status, file_name: v.file_name.slice(0, 200), file_size: v.file_size, message: v.message?.slice(0, 500) ?? null, created_by: a.userId, updated_by: a.userId,
  }).execute();
}

/** เปิดใช้ AI ได้ไหม (มีกุญแจ ยังไม่ถึงเพดาน) — หน้านำเข้า Excel ซ่อนปุ่ม AI เมื่อใช้ไม่ได้ */
export async function aiAvailability(db: Db, companyId: string) {
  const s = await status(db, companyId);
  return { available: s.available, has_key: s.has_key, model: s.model, monthly_limit_usd: s.monthly_limit_usd, month_cost_usd: s.month_cost_usd };
}
/** ข้อผิดพลาดจาก Anthropic → ข้อความไทยบอกวิธีแก้ */
function aiErrorMessage(e: unknown) {
  return e instanceof Anthropic.AuthenticationError ? 'กุญแจ API ไม่ถูกต้องหรือถูกยกเลิก — ผู้ดูแลตรวจที่ console.anthropic.com แล้วใส่ใหม่'
    : e instanceof Anthropic.PermissionDeniedError ? 'บัญชี Anthropic ไม่มีสิทธิ์ใช้รุ่นนี้ หรือเครดิตหมด — ตรวจที่ console.anthropic.com › Billing'
    : e instanceof Anthropic.RateLimitError ? 'เรียกใช้ถี่เกินกำหนดของบัญชี Anthropic — รอสักครู่แล้วลองใหม่'
    : e instanceof Anthropic.BadRequestError ? `Anthropic ไม่รับแฟ้มนี้: ${e.message.slice(0, 200)}`
    : e instanceof Anthropic.APIError ? `บริการ Anthropic ขัดข้อง (${e.status ?? 'เชื่อมต่อไม่ได้'}) — ลองใหม่ภายหลัง`
    : `เชื่อมต่อ Anthropic ไม่ได้: ${(e as Error).message.slice(0, 200)}`;
}
/** กุญแจและเพดานรายเดือน (ก่อนเรียก AI ทุกครั้ง) */
async function aiPrecheck(db: Db, companyId: string) {
  const key = await apiKeyOf(db, companyId);
  if (!key?.key) throw badRequest(key ? 'กุญแจ API ที่เก็บไว้ถอดรหัสไม่ได้ (ย้ายเครื่อง?) — ผู้ดูแลใส่กุญแจใหม่ที่ เริ่มระบบ › AI อ่านบิล' : 'ยังไม่ได้ตั้งค่า AI อ่านบิล — ผู้ดูแลใส่กุญแจ API ที่ เริ่มระบบ › AI อ่านบิล');
  const limit = await limitOf(db, companyId), used = await monthUsage(db, companyId);
  if (limit !== null && used.cost.gte(limit)) throw badRequest(`ใช้ AI เดือนนี้ครบเพดาน ${limit} ดอลลาร์แล้ว (ใช้ไป ${used.cost.toFixed(2)}) — ผู้ดูแลเพิ่มเพดานได้ที่ เริ่มระบบ › AI อ่านบิล หรือป้อนเอง`);
  return { key: key.key, limit, used: used.cost, model: await modelOf(db, companyId) };
}
/**
 * เรียก Claude ตอบตามโครงข้อมูล (structured outputs) — นำเข้า Excel: จับคู่คอลัมน์ / แนะนำรหัส (HANDOFF 168)
 * กุญแจ/เพดาน/รุ่นของบริษัทเดียวกับ AI อ่านบิล · บันทึกการใช้ (sys_ai_usage) ทุกครั้ง รวมเพดานเดือนเดียวกัน
 * ผิดพลาดหลังเรียก = คืน ok:false (ไม่ throw) ให้ผู้เรียกตอบโดยไม่ย้อนบันทึกการใช้
 */
export async function aiStructured(db: Db, a: AuthContext & { companyId: string }, o: { purpose: 'MAP' | 'SUGGEST'; file_name: string; file_size: number; system: string; prompt: string; schema: object; effort: 'low' | 'medium'; max_tokens: number }) {
  const pre = await aiPrecheck(db, a.companyId);
  let res: Awaited<ReturnType<AiClient['beta']['messages']['parse']>>;
  try {
    res = await makeClient(pre.key).beta.messages.parse({
      ...aiRequestOptions(pre.model), max_tokens: o.max_tokens,
      output_config: { effort: o.effort, format: jsonSchemaOutputFormat(o.schema as never) },
      system: o.system, messages: [{ role: 'user', content: o.prompt }],
    });
  } catch (e) {
    const message = aiErrorMessage(e);
    await record(db, a, { status: 'ERROR', file_name: o.file_name, file_size: o.file_size, purpose: o.purpose, message });
    return { ok: false as const, status: 502, code: 'AI_FAILED', message };
  }
  const cost = aiCost(res.usage, pre.model, res.model);
  const good = res.stop_reason !== 'refusal' && res.stop_reason !== 'max_tokens' && !!res.parsed_output;
  const message = good ? null : res.stop_reason === 'refusal' ? 'AI ปฏิเสธงานนี้ — จับคู่เอง' : 'AI ตอบไม่สำเร็จ — ลองอีกครั้ง หรือจับคู่เอง';
  await record(db, a, { model: res.model, usage: res.usage, cost: cost.toFixed(4), status: good ? 'OK' : res.stop_reason === 'refusal' ? 'REFUSED' : 'ERROR', file_name: o.file_name, file_size: o.file_size, purpose: o.purpose, message });
  const usage = { model: res.model, cost_usd: cost.toFixed(4), month_cost_usd: pre.used.plus(cost).toFixed(4), monthly_limit_usd: pre.limit };
  if (!good) return { ok: false as const, status: 422, code: 'AI_UNREADABLE', message: message!, usage };
  return { ok: true as const, parsed: res.parsed_output as unknown, usage };
}

export function aiRoutes(app: FastifyInstance, db: Db) {
  /** ทุกผู้ใช้ของบริษัท: เปิดใช้ได้ไหม (แสดงปุ่มอ่านบิล) */
  app.get('/api/v1/ai/status', async (req) => {
    const a = requireCompany(req);
    const s = await status(db, a.companyId);
    return { available: s.available, has_key: s.has_key, monthly_limit_usd: s.monthly_limit_usd, month_cost_usd: s.month_cost_usd };
  });

  app.get('/api/v1/ai/config', async (req) => status(db, requireCompany(req).companyId));

  app.put('/api/v1/ai/config', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      /** ไม่ส่ง = ไม่เปลี่ยน · null = ลบกุญแจ */
      api_key: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'กุญแจ API ของ Anthropic ขึ้นต้นด้วย sk-ant- — คัดลอกจาก console.anthropic.com › API Keys').nullable().optional(),
      monthly_limit_usd: z.union([z.number().min(0).max(100000), z.null()]),
      business_type: z.enum(Object.keys(AI_BUSINESS_TYPES) as [string, ...string[]]).nullable().optional(),
      guidance: z.string().max(4000, 'แนวทางยาวได้ไม่เกิน 4,000 ตัวอักษร').nullable().optional(),
      model: z.enum(AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]], { message: 'เลือกรุ่น AI จากรายการ' }).optional(),
    }), req.body);
    await db.transaction().execute(async (tx) => {
      if (b.api_key !== undefined) {
        await tx.updateTable('sys_secret').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('code', '=', SECRET).where('deleted_at', 'is', null).execute();
        if (b.api_key) await tx.insertInto('sys_secret').values({ company_id: a.companyId, code: SECRET, value_enc: encryptSecret(b.api_key), hint: `…${b.api_key.slice(-4)}`, created_by: a.userId, updated_by: a.userId }).execute();
      }
      await setSetting(tx, a.companyId, LIMIT_KEY, b.monthly_limit_usd, a.userId);
      if (b.business_type !== undefined) await setSetting(tx, a.companyId, 'ai.business_type', b.business_type, a.userId);
      if (b.guidance !== undefined) await setSetting(tx, a.companyId, 'ai.guidance', b.guidance?.trim() || null, a.userId);
      if (b.model !== undefined) await setSetting(tx, a.companyId, MODEL_KEY, b.model, a.userId);
      await logActivity(tx, a, { module: 'SET.AI', action: b.api_key === undefined ? 'AI_CONFIG' : b.api_key ? 'AI_KEY_SET' : 'AI_KEY_REMOVE', table: 'sys_secret', detail: { monthly_limit_usd: b.monthly_limit_usd, ...(b.model ? { model: b.model } : {}) } });
    });
    return status(db, a.companyId);
  });

  app.get('/api/v1/ai/usage', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
    const from = q.month ? `${q.month}-01` : null;
    return (await sql<Record<string, unknown>>`SELECT g.created_at, g.status, g.model, g.input_tokens, g.output_tokens, g.cost_usd, g.file_name, g.message, u.username
        FROM sys_ai_usage g LEFT JOIN sys_user u ON u.id = g.user_id
       WHERE g.company_id = ${a.companyId} AND g.deleted_at IS NULL
         AND g.created_at >= ${from ? sql`${from}::date` : sql`date_trunc('month', now())`} AND g.created_at < ${from ? sql`(${from}::date + interval '1 month')` : sql`date_trunc('month', now()) + interval '1 month'`}
       ORDER BY g.created_at DESC LIMIT 500`.execute(db)).rows;
  });

  /** อ่านบิล → ร่างข้อมูลเอกสารซื้อ (ผู้จำหน่ายตามเลขผู้เสียภาษี · รหัสสินค้า/ค่าใช้จ่ายตามชื่อ) — Claude อ่านรูป/PDF */
  app.post('/api/v1/ai/read-bill', async (req, reply) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      target: z.string().refine((p) => AI_BILL_TARGETS.some((k) => k.path === p), 'ชนิดเอกสารไม่ถูกต้อง'),
      file_name: z.string().trim().min(1).max(200), media_type: z.enum(MEDIA, { message: 'รองรับรูป JPG PNG WEBP GIF หรือ PDF เท่านั้น' }),
      data: z.string().min(10).max(Math.ceil(MAX_BYTES * 4 / 3) + 4, 'แฟ้มใหญ่เกิน 10 MB — ย่อรูปหรือสแกนใหม่'),
    }), req.body);
    const source = { type: 'base64' as const, media_type: b.media_type, data: b.data };
    return readBill(db, a, reply, { target: b.target, file_name: b.file_name, size: Math.floor(b.data.length * 3 / 4), read_by: 'claude_image', content: [
      b.media_type === 'application/pdf' ? { type: 'document', source: source as Anthropic.Beta.BetaBase64PDFSource } : { type: 'image', source: source as Anthropic.Beta.BetaBase64ImageSource },
      { type: 'text', text: `อ่าน${docWord(b.target)}นี้ตามโครงข้อมูล` },
    ] });
  });

  /**
   * อ่านบิลแบบผสม (เจ้าของ 18/11/2569): หน้าจออ่านภาพด้วย Typhoon-OCR ใน Ollama ของเครื่องผู้ใช้เอง แล้วส่งเฉพาะข้อความมา
   * Claude จัดร่างตามโครงเดิม + แนะนำรหัสเหมือนอ่านภาพ — ภาพไม่ออกจากเครื่อง ค่าใช้จ่ายต่ำกว่า · เพดาน/บันทึกการใช้แบบเดียวกัน (ระบุที่มาในหมายเหตุการใช้)
   */
  app.post('/api/v1/ai/read-bill-text', async (req, reply) => {
    const a = requireCompany(req);
    const b = parse(z.object({
      target: z.string().refine((p) => AI_BILL_TARGETS.some((k) => k.path === p), 'ชนิดเอกสารไม่ถูกต้อง'),
      file_name: z.string().trim().min(1).max(200), file_size: z.number().int().min(0).max(MAX_BYTES * 4),
      text: z.string().trim().min(10, 'ข้อความที่อ่านจากภาพสั้นเกินไป — ให้ Claude อ่านภาพแทน').max(60000, 'ข้อความยาวเกิน 60,000 ตัวอักษร — บิลมีหลายหน้าเกินไป'),
      pages: z.number().int().min(1).max(50).optional(), ocr_ms: z.number().int().min(0).max(3_600_000).optional(),
    }), req.body);
    return readBill(db, a, reply, { target: b.target, file_name: b.file_name, size: b.file_size, read_by: 'local_ocr',
      note: `อ่านภาพในเครื่องด้วย Typhoon-OCR${b.pages ? ` ${b.pages} หน้า` : ''}${b.ocr_ms ? ` ${(b.ocr_ms / 1000).toFixed(1)} วินาที` : ''} → Claude จัดร่างจากข้อความ`,
      content: [{ type: 'text', text: `ข้อความด้านล่างได้จากการอ่านภาพ${docWord(b.target)}ด้วย OCR (Typhoon-OCR) ในเครื่องของผู้ใช้ ไม่มีภาพแนบ — ตารางแสดงแถวละบรรทัด คั่นช่องด้วย " | " · OCR อาจอ่านตัวเลข/ตัวอักษรผิดได้ ถ้าตัวเลขขัดกันเอง (เช่น ยอดรวมไม่เท่ากับผลรวมรายการ) ให้ตอบตามที่พิมพ์และบอกใน notes\nอ่าน${docWord(b.target)}นี้ตามโครงข้อมูล\n\n<ocr>\n${b.text}\n</ocr>` }] });
  });
}

/** คำเรียกกระดาษที่อ่าน (ซื้อ/ขาย — HANDOFF 171) */
const docWord = (target: string) => { const s = aiBillSide(AI_BILL_TARGETS.find((k) => k.path === target) ?? { party: 'supplier' }); return s === 'sale' ? 'เอกสารขาย' : s === 'other' ? 'เอกสาร' : 'เอกสารซื้อ'; };
type ReadInput = { target: string; file_name: string; size: number; read_by: 'claude_image' | 'local_ocr'; note?: string; content: Anthropic.Beta.BetaContentBlockParam[] };
/** อ่านบิลด้วย Claude (รูป/PDF หรือข้อความจาก OCR) → ร่างบิล + ตรวจผู้จำหน่าย/บิลซ้ำ + แนะนำรหัส · ตรวจกุญแจและเพดานก่อนเรียกทุกครั้ง */
async function readBill(db: Db, a: AuthContext & { companyId: string }, reply: FastifyReply, b: ReadInput) {
  // ผิดพลาดหลังเรียก AI: ตอบข้อผิดพลาดโดยไม่ throw เพื่อให้บันทึกการใช้ (มีค่าใช้จ่าย) ไม่ถูกย้อนกลับไปกับทรานแซกชันของคำขอ
  const fail = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
  const size = b.size;
  const key = await apiKeyOf(db, a.companyId);
  if (!key?.key) throw badRequest(key ? 'กุญแจ API ที่เก็บไว้ถอดรหัสไม่ได้ (ย้ายเครื่อง?) — ผู้ดูแลใส่กุญแจใหม่ที่ เริ่มระบบ › AI อ่านบิล' : 'ยังไม่ได้ตั้งค่า AI อ่านบิล — ผู้ดูแลใส่กุญแจ API ที่ เริ่มระบบ › AI อ่านบิล');
  const limit = await limitOf(db, a.companyId), used = await monthUsage(db, a.companyId);
  if (limit !== null && used.cost.gte(limit)) throw badRequest(`ใช้ AI เดือนนี้ครบเพดาน ${limit} ดอลลาร์แล้ว (ใช้ไป ${used.cost.toFixed(2)}) — ผู้ดูแลเพิ่มเพดานได้ที่ เริ่มระบบ › AI อ่านบิล หรือป้อนเอง`);
  const model = await modelOf(db, a.companyId);
  const K = AI_BILL_TARGETS.find((k) => k.path === b.target)!;
  const side = aiBillSide(K);

  let res: Awaited<ReturnType<AiClient['beta']['messages']['parse']>>;
  try {
    res = await makeClient(key.key).beta.messages.parse({
      // รุ่นที่บริษัทเลือก · Sonnet/Opus ที่ปฏิเสธ (refusal) ส่งต่อให้รุ่นสำรองอัตโนมัติ (Haiku ไม่มีรุ่นสำรอง)
      ...aiRequestOptions(model), max_tokens: 16000,
      output_config: { effort: 'medium', format: jsonSchemaOutputFormat(BILL_SCHEMA as never) },
      system: side === 'sale' ? BILL_SYSTEM_PROMPT_SALES : side === 'other' ? BILL_SYSTEM_PROMPT_OTHER : BILL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: b.content }],
    });
  } catch (e) {
    const msg = aiErrorMessage(e);
    await record(db, a, { status: 'ERROR', file_name: b.file_name, file_size: size, message: b.note ? `${msg} (${b.note})` : msg });
    return fail(502, 'AI_FAILED', msg);
  }
  const cost = aiCost(res.usage, model, res.model).toFixed(4);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens' || !res.parsed_output) {
    const msg = res.stop_reason === 'refusal' ? 'AI ปฏิเสธการอ่านแฟ้มนี้ — ป้อนเอง' : 'AI อ่านแฟ้มนี้ไม่สำเร็จ — ลองรูปที่ชัดกว่า หรือป้อนเอง';
    await record(db, a, { model: res.model, usage: res.usage, cost, status: res.stop_reason === 'refusal' ? 'REFUSED' : 'ERROR', file_name: b.file_name, file_size: size, message: b.note ? `${msg} (${b.note})` : msg });
    return fail(422, 'AI_UNREADABLE', msg);
  }
  await record(db, a, { model: res.model, usage: res.usage, cost, status: 'OK', file_name: b.file_name, file_size: size, message: b.note ?? null });
  const bill = normalizeBill(res.parsed_output as unknown as RawBill, side);
  // ผู้ซื้อในบิลต้องเป็นบริษัทนี้ (เจ้าของ 19/11/2569): อ่านเพี้ยนเล็กน้อย = ใช้เลขของบริษัท · เลขของผู้อื่น = เตือนก่อนใช้ขอคืนภาษีซื้อ
  // ฝั่งขาย (HANDOFF 171): ผู้ขายในเอกสาร (ถ้ามี) ต้องเป็นบริษัทนี้ — ลูกค้าคือผู้ซื้อ
  const co = await db.selectFrom('sys_company').select(['tax_id', 'name_th']).where('id', '=', a.companyId).executeTakeFirst();
  const buyer0 = buyerTaxCheck(side === 'sale' ? bill.supplier.tax_id_read : bill.buyer.tax_id_read, co?.tax_id);
  const buyer = side === 'sale' && buyer0.message ? { ...buyer0, message: `ผู้ขายในเอกสาร (เลข ${buyer0.shown}) ไม่ใช่บริษัทนี้ — ตรวจว่าเป็นเอกสารขายของกิจการนี้ (ลูกค้าคือผู้ซื้อในเอกสาร)` } : buyer0;
  if (buyer.message) bill.warnings.unshift(buyer.message);

  // เอกสารที่ไม่มีคู่ค้า (ธนาคาร คลัง เงินสดย่อย ใบสำคัญ): ไม่หาคู่ค้า · ใบสำคัญดูผู้ขายในเอกสารเทียบบริษัทเพื่อแยกบิลซื้อ/ขาย (seller_check)
  const sc = side === 'sale' ? await checkCustomer(db, a.companyId, bill) : side === 'other' ? { supplier: null, status: 'none', message: '', candidate: null } : await checkSupplier(db, a.companyId, bill);
  const seller = side === 'other' ? buyerTaxCheck(bill.supplier.tax_id_read, co?.tax_id) : null;
  // บิลซ้ำ: ซื้อ = เลขที่บิลผู้จำหน่ายเดียวกัน (ทุกชนิด) · ขาย = อ้างอิง (เลขที่ใบสั่งซื้อของลูกค้า) เดียวกันในเอกสารชนิดเดียวกัน (ใบสั่งขายแล้วออกบิลด้วยเลขเดียวกันได้)
  const dup = sc.supplier && bill.doc_no ? (side === 'sale'
    ? (await sql<{ doc_no: string; doc_class: string; doc_date: string }>`SELECT doc_no, doc_class, doc_date::text AS doc_date FROM doc_header
      WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_status <> 'C' AND customer_id = ${sc.supplier.id} AND doc_class = ${K.cls} AND your_ref = ${bill.doc_no} ORDER BY doc_date DESC LIMIT 1`.execute(db)).rows[0] ?? null
    : (await sql<{ doc_no: string; doc_class: string; doc_date: string }>`SELECT doc_no, doc_class, doc_date::text AS doc_date FROM doc_header
      WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_status <> 'C' AND supplier_id = ${sc.supplier.id} AND ref_no = ${bill.doc_no} ORDER BY doc_date DESC LIMIT 1`.execute(db)).rows[0] ?? null) : null;
  const mode = K.lines === 'text' ? null : K.lines === 'stock' ? 'stock' : side === 'sale' ? (K.lines === 'income' ? 'income' : 'sale') : K.service ? 'expense' : 'purchase';
  const sg = mode ? await suggestLines(db, a, key.key, model, mode, bill, sc.supplier, b.file_name, size)
    : { lines: bill.lines.map(() => ({ suggestion: null, alternatives: [], item: null, note: null })), cost: d(0), note: null };
  const total = d(cost).plus(sg.cost).toFixed(4);
  await logActivity(db, a, { module: K.menu, action: 'AI_READ_BILL', docNo: bill.doc_no || null, detail: { file: b.file_name, read_by: b.read_by, cost_usd: total, side, party: sc.supplier?.code ?? null, party_check: sc.status, duplicate: dup?.doc_no ?? null } });
  return {
    /** supplier = คู่ค้าที่พบ (ฝั่งขาย = ลูกค้า — ชื่อเดิมของช่อง) · side บอกฝั่ง */
    bill, side, supplier: sc.supplier, ...(seller ? { seller_check: { status: seller.status } } : {}), supplier_check: { status: sc.status, message: sc.message, candidate: sc.candidate }, duplicate: dup,
    lines: bill.lines.map((l, i) => ({ ...l, ...sg.lines[i]! })), suggest_note: sg.note, read_by: b.read_by, buyer_check: { ...buyer, company_name: co?.name_th ?? null, company_tax_id: co?.tax_id ?? null },
    usage: { model: res.model, cost_usd: total, month_cost_usd: used.cost.plus(total).toFixed(4), monthly_limit_usd: limit },
  };
}

type Sup = { id: string; code: string; name: string; tax_id: string | null; tax_branch_no: string | null };
/**
 * ตรวจผู้จำหน่ายกับแฟ้มของบริษัท: เลขผู้เสียภาษีถูกรูปแบบ · พบตามเลข (ชื่อ/สาขาตรงไหม) · ไม่พบตามเลขแต่มีชื่อคล้าย (เลขในระบบต่างกัน) · ผู้จำหน่ายใหม่
 */
async function checkSupplier(db: Db, companyId: string, bill: BillDraft): Promise<{ supplier: Sup | null; status: string; message: string; candidate: Sup | null }> {
  const tax = bill.supplier.tax_id;
  const all = (await sql<Sup>`SELECT id, code, name, replace(coalesce(tax_id, ''), '-', '') AS tax_id, tax_branch_no FROM md_supplier WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'A' LIMIT 20000`.execute(db)).rows;
  const ck = tax ? checkTaxId(tax) : null;
  const badTax = ck && !ck.ok ? ` · เลขผู้เสียภาษีในบิล ${tax} ${ck.error} (อ่านผิดหรือบิลพิมพ์ผิด)` : '';
  const byTax = tax ? all.filter((x) => x.tax_id === tax) : [];
  if (byTax.length) {
    // สาขาของผู้จำหน่าย (แท็บสาขา — เจ้าของ 19/11/2569): สาขาในบิลอยู่ในแฟ้มหรือแท็บสาขา = ตรง · ไม่มี = เสนอเพิ่มสาขาให้รายนี้ (ไม่สร้างเจ้าหนี้ซ้ำ)
    const brs = await sql<{ supplier_id: string; branch_no: string; name: string }>`SELECT supplier_id, branch_no, name FROM md_supplier_branch WHERE company_id = ${companyId} AND deleted_at IS NULL AND supplier_id = ANY(${byTax.map((x) => x.id)}::uuid[])`.execute(db);
    const want = bill.supplier.branch_no;
    const has = (x: Sup) => !want || (x.tax_branch_no ?? '00000') === want || brs.rows.some((r) => r.supplier_id === x.id && r.branch_no === want);
    const s = byTax.find(has) ?? byTax[0]!;
    const sim = textSim(bill.supplier.name, s.name);
    if (bill.supplier.name && sim < 0.45) return { supplier: s, status: 'name_mismatch', message: `เลขผู้เสียภาษีตรงกับ ${s.code} ${s.name} แต่ชื่อในบิล "${bill.supplier.name}" ต่างกัน — ตรวจว่าเป็นรายเดียวกัน${badTax}`, candidate: null };
    if (!has(s)) return { supplier: s, status: 'branch_new', message: `ผู้จำหน่าย ${s.code} ${s.name} เลขผู้เสียภาษีตรงกัน แต่ยังไม่มีสาขา ${want} — เพิ่มสาขานี้ให้ ${s.code} (ไม่สร้างเจ้าหนี้ซ้ำ) · ภาษีซื้อต้องใช้สาขาตามใบกำกับ`, candidate: null };
    const bn = brs.rows.find((r) => r.supplier_id === s.id && r.branch_no === want);
    if (bn) return { supplier: s, status: 'match', message: `ตรงกับผู้จำหน่าย ${s.code} ${s.name} สาขา ${bn.branch_no} ${bn.name}${badTax}`, candidate: null };
    return { supplier: s, status: 'match', message: `ตรงกับผู้จำหน่าย ${s.code} ${s.name} (เลขผู้เสียภาษี${bill.supplier.branch_no ? ` สาขา ${bill.supplier.branch_no}` : ''} ตรงกัน)${badTax}`, candidate: null };
  }
  const near = bill.supplier.name ? all.map((x) => ({ x, sim: textSim(bill.supplier.name, x.name) })).filter((r) => r.sim >= 0.6).sort((p, q) => q.sim - p.sim)[0]?.x ?? null : null;
  if (near) {
    if (!near.tax_id) return { supplier: null, status: 'no_tax', message: `พบผู้จำหน่ายชื่อคล้าย ${near.code} ${near.name} แต่แฟ้มยังไม่มีเลขผู้เสียภาษี${tax ? ` — ถ้าเป็นรายเดียวกัน เพิ่มเลข ${tax} ที่แฟ้มผู้จำหน่าย` : ''}${badTax}`, candidate: near };
    return { supplier: null, status: 'tax_mismatch', message: `ชื่อคล้ายผู้จำหน่าย ${near.code} ${near.name} แต่เลขผู้เสียภาษีในแฟ้ม (${near.tax_id}) ไม่ตรงกับบิล (${tax ?? 'ไม่มี'}) — ตรวจว่าบิลหรือแฟ้มผิด${badTax}`, candidate: near };
  }
  return { supplier: null, status: 'new', message: `ผู้จำหน่ายใหม่ ยังไม่มีในแฟ้ม${tax ? ` (เลขผู้เสียภาษี ${tax})` : ''} — เพิ่มที่ รายละเอียดผู้จำหน่าย ก่อนบันทึก${badTax}`, candidate: null };
}

/**
 * ตรวจลูกค้ากับแฟ้มของบริษัท (อ่านกระดาษฝั่งขาย — HANDOFF 171): ลูกค้า = ผู้ซื้อในเอกสาร · พบตามเลขผู้เสียภาษี (+สาขาในแท็บสาขา) · ชื่อคล้าย · ลูกค้าใหม่
 * ไม่มีปุ่มเพิ่มลูกค้าจากบิล — ผู้ใช้เลือก/เพิ่มลูกค้าในเอกสาร
 */
async function checkCustomer(db: Db, companyId: string, bill: BillDraft): Promise<{ supplier: Sup | null; status: string; message: string; candidate: Sup | null }> {
  const read = bill.buyer.tax_id_read, name = bill.buyer.name, want = bill.buyer.branch_no ?? null;
  const tax = read.length === 13 ? read : null;
  const all = (await sql<Sup>`SELECT id, code, name, replace(coalesce(tax_id, ''), '-', '') AS tax_id, tax_branch_no FROM md_customer WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'A' LIMIT 20000`.execute(db)).rows;
  const ck = tax ? checkTaxId(tax) : null;
  const badTax = ck && !ck.ok ? ` · เลขผู้เสียภาษีในเอกสาร ${tax} ${ck.error} (อ่านผิดหรือพิมพ์ผิด)` : '';
  const byTax = tax ? all.filter((x) => x.tax_id === tax) : [];
  if (byTax.length) {
    const brs = await sql<{ customer_id: string; branch_no: string; name: string }>`SELECT customer_id, branch_no, name FROM md_customer_branch WHERE company_id = ${companyId} AND deleted_at IS NULL AND customer_id = ANY(${byTax.map((x) => x.id)}::uuid[])`.execute(db);
    const has = (x: Sup) => !want || (x.tax_branch_no ?? '00000') === want || brs.rows.some((r) => r.customer_id === x.id && r.branch_no === want);
    const c = byTax.find(has) ?? byTax[0]!;
    if (name && textSim(name, c.name) < 0.45) return { supplier: c, status: 'name_mismatch', message: `เลขผู้เสียภาษีตรงกับลูกค้า ${c.code} ${c.name} แต่ชื่อในเอกสาร "${name}" ต่างกัน — ตรวจว่าเป็นรายเดียวกัน${badTax}`, candidate: null };
    if (!has(c)) return { supplier: c, status: 'branch_new', message: `ลูกค้า ${c.code} ${c.name} เลขผู้เสียภาษีตรงกัน แต่ยังไม่มีสาขา ${want} — เพิ่มสาขาที่แท็บสาขาในรายละเอียดลูกค้า แล้วเลือก Bill to (สาขา) ในเอกสาร`, candidate: null };
    return { supplier: c, status: 'match', message: `ตรงกับลูกค้า ${c.code} ${c.name} (เลขผู้เสียภาษี${want ? ` สาขา ${want}` : ''} ตรงกัน)${badTax}`, candidate: null };
  }
  const near = name ? all.map((x) => ({ x, sim: textSim(name, x.name) })).filter((r) => r.sim >= 0.6).sort((p, q) => q.sim - p.sim)[0]?.x ?? null : null;
  if (near) return { supplier: null, status: near.tax_id && tax ? 'tax_mismatch' : 'no_tax', message: near.tax_id && tax ? `ชื่อคล้ายลูกค้า ${near.code} ${near.name} แต่เลขผู้เสียภาษีในแฟ้ม (${near.tax_id}) ไม่ตรงกับเอกสาร (${tax}) — ตรวจว่าเอกสารหรือแฟ้มผิด${badTax}`
    : `พบลูกค้าชื่อคล้าย ${near.code} ${near.name}${tax ? ` — ถ้าเป็นรายเดียวกัน เพิ่มเลข ${tax} ที่แฟ้มลูกค้า` : ''}${badTax}`, candidate: near };
  return { supplier: null, status: 'new', message: `ลูกค้าใหม่ ยังไม่มีในแฟ้ม${tax ? ` (เลขผู้เสียภาษี ${tax})` : ''}${name ? ` "${name}"` : ''} — เลือกหรือเพิ่มลูกค้าในเอกสาร${badTax}`, candidate: null };
}

type Cat = { id: string; code: string; name_th: string; item_type: string; remark: string | null; base_unit_id: string | null; account: string | null };
type Suggestion = { item: { id: string; code: string; name_th: string; item_type: string; base_unit_id: string | null }; kind: 'item' | 'expense'; account: string | null; confidence: 'high' | 'medium' | 'low'; reason: string; source: 'ai' | 'history' | 'name' };
const kindOf = (t: string) => (t === '5' || t === '2' ? 'expense' : 'item') as 'item' | 'expense';
const pickOf = (c: Cat) => ({ id: c.id, code: c.code, name_th: c.name_th, item_type: c.item_type, base_unit_id: c.base_unit_id });

/**
 * แนะนำรหัส (สินค้า/ค่าใช้จ่าย) รายบรรทัด จากข้อมูลของบริษัทนี้เท่านั้น:
 * 1) ประวัติ: บรรทัดซื้อ/ค่าใช้จ่ายที่บันทึกแล้ว (ผ่านการยืนยันของพนักงานบัญชี) ที่คำอธิบายคล้ายกัน — ผู้จำหน่ายรายเดียวกันได้น้ำหนักมากกว่า
 * 2) แฟ้มรหัส: ชื่อ/หมายเหตุของรหัสสินค้าและรหัสค่าใช้จ่ายที่คล้ายกัน
 * 3) Claude เลือกจากรายการข้อ 1–2 ตามประเภทธุรกิจและแนวทางของบริษัท (ตั้งที่ เริ่มระบบ › AI อ่านบิล) — ผิดพลาดใช้ประวัติแทน
 */
async function suggestLines(db: Db, a: AuthContext & { companyId: string }, apiKey: string, model: AiModelId, mode: 'purchase' | 'expense' | 'sale' | 'income' | 'stock', bill: BillDraft, sup: Sup | null, fileName: string, size: number) {
  const expenseOnly = mode === 'expense', sale = mode === 'sale' || mode === 'income';
  // ขาย = สินค้า/ชุด/บริการ (HANDOFF 171) · รายได้อื่น = รหัสรายได้ (4)
  const types = expenseOnly ? ['5', '2'] : mode === 'sale' ? ['0', '1', '2', '3'] : mode === 'income' ? ['4'] : mode === 'stock' ? ['0'] : ['0', '1', '2', '3', '5'];
  const cat = (await sql<Cat>`SELECT i.id, i.code, i.name_th, i.item_type, i.remark, i.base_unit_id,
        (SELECT ac.account_no || ' ' || ac.name_th FROM gl_account ac WHERE ac.id = CASE WHEN ${sale} THEN coalesce(g.sales_account_id, g.inventory_account_id) WHEN i.item_type IN ('5', '2') THEN g.inventory_account_id ELSE coalesce(g.purchase_account_id, g.inventory_account_id) END) AS account
      FROM md_item i LEFT JOIN md_item_account_group g ON g.id = i.account_group_id
     WHERE i.company_id = ${a.companyId} AND i.deleted_at IS NULL AND i.status = 'A' AND i.item_type = ANY(${types}::text[]) ORDER BY i.code LIMIT 8000`.execute(db)).rows;
  const byId = new Map(cat.map((c) => [c.id, c])), byCode = new Map(cat.map((c) => [c.code, c]));
  const classes = mode === 'sale' ? ['IV', 'HS', 'SO', 'QT', 'DR', 'CN'] : mode === 'income' ? ['OI'] : mode === 'stock' ? ['OU', 'RL', 'JU', 'CA', 'RR', 'HP'] : ['RR', 'HP', 'OE'];
  const hist = (await sql<{ description: string | null; item_id: string; supplier_id: string | null }>`SELECT l.description, l.item_id, ${sale ? sql`h.customer_id` : sql`h.supplier_id`} AS supplier_id FROM doc_line l JOIN doc_header h ON h.id = l.header_id
      WHERE h.company_id = ${a.companyId} AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND h.doc_status <> 'C' AND h.doc_class = ANY(${classes}::text[]) AND l.item_id IS NOT NULL
        AND h.doc_date >= (current_date - 1095) ORDER BY h.doc_date DESC LIMIT 4000`.execute(db)).rows;
  const per = bill.lines.map((l) => {
    const agg = new Map<string, { n: number; same: number; best: number }>();
    for (const r of hist) {
      if (!byId.has(r.item_id)) continue;
      const sim = Math.max(textSim(l.description, r.description), textSim(l.description, byId.get(r.item_id)!.name_th) * 0.95);
      if (sim < 0.6) continue;
      const g = agg.get(r.item_id) ?? { n: 0, same: 0, best: 0 };
      g.n++; if (sup && r.supplier_id === sup.id) g.same++; g.best = Math.max(g.best, sim);
      agg.set(r.item_id, g);
    }
    const history = [...agg.entries()].sort((p, q) => q[1].same - p[1].same || q[1].n - p[1].n || q[1].best - p[1].best).slice(0, 3).map(([id, g]) => ({ c: byId.get(id)!, ...g }));
    const names = cat.map((c) => ({ c, sim: Math.max(textSim(l.description, c.name_th), textSim(l.description, c.remark) * 0.9) })).filter((x) => x.sim >= 0.3)
      .sort((p, q) => q.sim - p.sim).slice(0, 5);
    return { history, names };
  });
  // รายการรหัสทั้งหมดที่ส่งให้ AI: ซื้อ = รหัสค่าใช้จ่าย · รายได้อื่น = รหัสรายได้ · ขาย = ไม่ส่ง (เลือกจาก candidates)
  const expenses = mode === 'sale' || mode === 'stock' ? [] : mode === 'income' ? cat : cat.filter((c) => kindOf(c.item_type) === 'expense');
  const expList = (expenses.length <= 200 ? expenses : expenses.map((c) => ({ c, s: Math.max(...bill.lines.map((l) => textSim(l.description, c.name_th))) })).sort((p, q) => q.s - p.s).slice(0, 30).map((x) => x.c));

  // ค่าเริ่มต้น: ประวัติที่คล้ายมาก หรือชื่อรหัสตรงกัน
  const local = (i: number): Suggestion | null => {
    const h = per[i]!.history[0];
    if (h && h.best >= 0.8) return { item: pickOf(h.c), kind: kindOf(h.c.item_type), account: h.c.account, confidence: h.same >= 1 && h.n >= 2 ? 'high' : 'medium', reason: `เคยลงรหัสนี้ ${h.n} ครั้ง${h.same ? ` (กับ${sale ? 'ลูกค้า' : 'ผู้จำหน่าย'}นี้ ${h.same} ครั้ง)` : ''}`, source: 'history' };
    const n = per[i]!.names[0];
    if (n && n.sim >= 0.85) return { item: pickOf(n.c), kind: kindOf(n.c.item_type), account: n.c.account, confidence: 'medium', reason: 'ชื่อตรงกับรหัสในแฟ้ม', source: 'name' };
    return null;
  };
  type AiPick = { index: number; code: string | null; confidence: 'high' | 'medium' | 'low'; reason: string };
  let ai: AiPick[] | null = null;
  let cost = d(0), note: string | null = null;
  if (bill.lines.length && cat.length) {
    const s = await companySettings(db, a.companyId);
    const cand = (i: number) => {
      const seen = new Set<string>(); const out: SuggestCandidate[] = [];
      for (const h of per[i]!.history) if (!seen.has(h.c.id)) { seen.add(h.c.id); out.push({ code: h.c.code, name: h.c.name_th, kind: kindOf(h.c.item_type), account: h.c.account, history: h.n, sameSupplier: h.same }); }
      for (const n of per[i]!.names) if (!seen.has(n.c.id)) { seen.add(n.c.id); out.push({ code: n.c.code, name: n.c.name_th + (n.c.remark ? ` (${n.c.remark.slice(0, 60)})` : ''), kind: kindOf(n.c.item_type), account: n.c.account }); }
      return out;
    };
    try {
      const res = await makeClient(apiKey).beta.messages.parse({
        ...aiRequestOptions(model), max_tokens: 8000,
        output_config: { effort: 'low', format: jsonSchemaOutputFormat(SUGGEST_SCHEMA as never) },
        system: SUGGEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: suggestPrompt({ businessType: s['ai.business_type'] as string | null, guidance: s['ai.guidance'] as string | null, target: mode,
          supplierName: sup?.name ?? bill.supplier.name, supplierKnown: !!sup, lines: bill.lines.map((l, i) => ({ index: i, description: l.description, amount: l.amount, candidates: cand(i) })),
          expenseCodes: expList.map((c) => ({ code: c.code, name: c.name_th, kind: 'expense', account: c.account })) }) }],
      });
      cost = aiCost(res.usage, model, res.model);
      const ok = res.stop_reason !== 'refusal' && res.stop_reason !== 'max_tokens' && res.parsed_output;
      await record(db, a, { model: res.model, usage: res.usage, cost: cost.toFixed(4), status: ok ? 'OK' : res.stop_reason === 'refusal' ? 'REFUSED' : 'ERROR', file_name: fileName, file_size: size, purpose: 'SUGGEST', message: ok ? null : 'แนะนำรหัสไม่สำเร็จ' });
      if (ok) ai = (res.parsed_output as unknown as { lines: AiPick[] }).lines;
      else note = 'AI แนะนำรหัสไม่สำเร็จ — ใช้ประวัติการลงบัญชีแทน';
    } catch (e) {
      note = 'AI แนะนำรหัสไม่สำเร็จ — ใช้ประวัติการลงบัญชีแทน';
      await record(db, a, { status: 'ERROR', file_name: fileName, file_size: size, purpose: 'SUGGEST', message: `แนะนำรหัส: ${(e as Error).message.slice(0, 200)}` });
    }
  }
  const lines = bill.lines.map((_, i) => {
    const r = ai?.find((x) => x.index === i);
    const c = r?.code ? byCode.get(r.code) : undefined;
    let suggestion: Suggestion | null = c ? { item: pickOf(c), kind: kindOf(c.item_type), account: c.account, confidence: r!.confidence, reason: r!.reason, source: 'ai' } : local(i);
    if (suggestion && suggestion.source === 'ai' && !per[i]!.history.some((h) => h.c.id === suggestion!.item.id) && !per[i]!.names.some((n) => n.c.id === suggestion!.item.id) && suggestion.kind === 'item') suggestion = { ...suggestion, confidence: 'low' };
    const alts = [...per[i]!.history.map((h) => h.c), ...per[i]!.names.map((n) => n.c)].filter((x, k, arr) => arr.findIndex((y) => y.id === x.id) === k && x.id !== suggestion?.item.id).slice(0, 4)
      .map((x) => ({ ...pickOf(x), kind: kindOf(x.item_type), account: x.account }));
    const warn = !suggestion ? (r?.reason ? `ไม่มีรหัสที่เหมาะ: ${r.reason}` : null)
      : !expenseOnly ? null : suggestion.kind !== 'expense' ? 'รายการนี้น่าจะเป็นสินค้า — ควรบันทึกที่ ซื้อเงินเชื่อ/เงินสด' : null;
    return { suggestion, alternatives: alts, item: suggestion?.item ?? null, note: warn };
  });
  return { lines, cost, note };
}
