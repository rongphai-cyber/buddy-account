import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { sql } from 'kysely';
import { z } from 'zod';
import { AI_BILL_TARGETS, AI_MODEL, aiCost, BILL_SCHEMA, BILL_SYSTEM_PROMPT, d, normalizeBill, type RawBill } from '@buddy/core';
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
  const r = (await sql<{ cost: string; n: number }>`SELECT coalesce(sum(cost_usd), 0)::text AS cost, count(*) FILTER (WHERE status = 'OK')::int AS n FROM sys_ai_usage
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())`.execute(db)).rows[0]!;
  return { cost: d(r.cost), count: r.n };
}
async function status(db: Db, companyId: string) {
  const [k, limit, u] = await Promise.all([apiKeyOf(db, companyId), limitOf(db, companyId), monthUsage(db, companyId)]);
  return { model: AI_MODEL, has_key: !!k?.key, key_hint: k?.hint ?? null, key_broken: !!k && !k.key, monthly_limit_usd: limit, month_cost_usd: u.cost.toFixed(4), month_count: u.count,
    available: !!k?.key && (limit === null || u.cost.lt(limit)) };
}

async function record(db: Db, a: AuthContext & { companyId: string }, v: { model?: string | null; usage?: Anthropic.Beta.BetaUsage | null; cost?: string; status: 'OK' | 'ERROR' | 'REFUSED'; file_name: string; file_size: number; message?: string | null }) {
  await db.insertInto('sys_ai_usage').values({
    company_id: a.companyId, user_id: a.userId, purpose: 'BILL', model: v.model ?? null,
    input_tokens: v.usage?.input_tokens ?? 0, output_tokens: v.usage?.output_tokens ?? 0,
    cache_read_tokens: v.usage?.cache_read_input_tokens ?? 0, cache_write_tokens: v.usage?.cache_creation_input_tokens ?? 0,
    cost_usd: v.cost ?? '0', status: v.status, file_name: v.file_name.slice(0, 200), file_size: v.file_size, message: v.message?.slice(0, 500) ?? null, created_by: a.userId, updated_by: a.userId,
  }).execute();
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
    }), req.body);
    await db.transaction().execute(async (tx) => {
      if (b.api_key !== undefined) {
        await tx.updateTable('sys_secret').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('code', '=', SECRET).where('deleted_at', 'is', null).execute();
        if (b.api_key) await tx.insertInto('sys_secret').values({ company_id: a.companyId, code: SECRET, value_enc: encryptSecret(b.api_key), hint: `…${b.api_key.slice(-4)}`, created_by: a.userId, updated_by: a.userId }).execute();
      }
      await setSetting(tx, a.companyId, LIMIT_KEY, b.monthly_limit_usd, a.userId);
      await logActivity(tx, a, { module: 'SET.AI', action: b.api_key === undefined ? 'AI_CONFIG' : b.api_key ? 'AI_KEY_SET' : 'AI_KEY_REMOVE', table: 'sys_secret', detail: { monthly_limit_usd: b.monthly_limit_usd } });
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

  /** อ่านบิล → ร่างข้อมูลเอกสารซื้อ (ผู้จำหน่ายตามเลขผู้เสียภาษี · รหัสสินค้า/ค่าใช้จ่ายตามชื่อ) */
  app.post('/api/v1/ai/read-bill', async (req, reply) => {
    // ผิดพลาดหลังเรียก AI: ตอบข้อผิดพลาดโดยไม่ throw เพื่อให้บันทึกการใช้ (มีค่าใช้จ่าย) ไม่ถูกย้อนกลับไปกับทรานแซกชันของคำขอ
    const fail = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
    const a = requireCompany(req);
    const b = parse(z.object({
      target: z.string().refine((p) => AI_BILL_TARGETS.some((k) => k.path === p), 'ชนิดเอกสารไม่ถูกต้อง'),
      file_name: z.string().trim().min(1).max(200), media_type: z.enum(MEDIA, { message: 'รองรับรูป JPG PNG WEBP GIF หรือ PDF เท่านั้น' }),
      data: z.string().min(10).max(Math.ceil(MAX_BYTES * 4 / 3) + 4, 'แฟ้มใหญ่เกิน 10 MB — ย่อรูปหรือสแกนใหม่'),
    }), req.body);
    const size = Math.floor(b.data.length * 3 / 4);
    const key = await apiKeyOf(db, a.companyId);
    if (!key?.key) throw badRequest(key ? 'กุญแจ API ที่เก็บไว้ถอดรหัสไม่ได้ (ย้ายเครื่อง?) — ผู้ดูแลใส่กุญแจใหม่ที่ เริ่มระบบ › AI อ่านบิล' : 'ยังไม่ได้ตั้งค่า AI อ่านบิล — ผู้ดูแลใส่กุญแจ API ที่ เริ่มระบบ › AI อ่านบิล');
    const limit = await limitOf(db, a.companyId), used = await monthUsage(db, a.companyId);
    if (limit !== null && used.cost.gte(limit)) throw badRequest(`ใช้ AI เดือนนี้ครบเพดาน ${limit} ดอลลาร์แล้ว (ใช้ไป ${used.cost.toFixed(2)}) — ผู้ดูแลเพิ่มเพดานได้ที่ เริ่มระบบ › AI อ่านบิล หรือป้อนเอง`);

    const source = { type: 'base64' as const, media_type: b.media_type, data: b.data };
    let res: Awaited<ReturnType<AiClient['beta']['messages']['parse']>>;
    try {
      res = await makeClient(key.key).beta.messages.parse({
        model: AI_MODEL, max_tokens: 16000,
        // รุ่นที่ปฏิเสธ (refusal) ส่งต่อให้รุ่นสำรองอัตโนมัติ
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'medium', format: jsonSchemaOutputFormat(BILL_SCHEMA as never) },
        system: BILL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          b.media_type === 'application/pdf' ? { type: 'document', source: source as Anthropic.Beta.BetaBase64PDFSource } : { type: 'image', source: source as Anthropic.Beta.BetaBase64ImageSource },
          { type: 'text', text: 'อ่านเอกสารซื้อนี้ตามโครงข้อมูล' },
        ] }],
      });
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? 'กุญแจ API ไม่ถูกต้องหรือถูกยกเลิก — ผู้ดูแลตรวจที่ console.anthropic.com แล้วใส่ใหม่'
        : e instanceof Anthropic.PermissionDeniedError ? 'บัญชี Anthropic ไม่มีสิทธิ์ใช้รุ่นนี้ หรือเครดิตหมด — ตรวจที่ console.anthropic.com › Billing'
        : e instanceof Anthropic.RateLimitError ? 'เรียกใช้ถี่เกินกำหนดของบัญชี Anthropic — รอสักครู่แล้วลองใหม่'
        : e instanceof Anthropic.BadRequestError ? `Anthropic ไม่รับแฟ้มนี้: ${e.message.slice(0, 200)}`
        : e instanceof Anthropic.APIError ? `บริการ Anthropic ขัดข้อง (${e.status ?? 'เชื่อมต่อไม่ได้'}) — ลองใหม่ภายหลัง`
        : `เชื่อมต่อ Anthropic ไม่ได้: ${(e as Error).message.slice(0, 200)}`;
      await record(db, a, { status: 'ERROR', file_name: b.file_name, file_size: size, message: msg });
      return fail(502, 'AI_FAILED', msg);
    }
    const cost = aiCost(res.usage, AI_MODEL, res.model).toFixed(4);
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens' || !res.parsed_output) {
      const msg = res.stop_reason === 'refusal' ? 'AI ปฏิเสธการอ่านแฟ้มนี้ — ป้อนเอง' : 'AI อ่านแฟ้มนี้ไม่สำเร็จ — ลองรูปที่ชัดกว่า หรือป้อนเอง';
      await record(db, a, { model: res.model, usage: res.usage, cost, status: res.stop_reason === 'refusal' ? 'REFUSED' : 'ERROR', file_name: b.file_name, file_size: size, message: msg });
      return fail(422, 'AI_UNREADABLE', msg);
    }
    await record(db, a, { model: res.model, usage: res.usage, cost, status: 'OK', file_name: b.file_name, file_size: size });
    const bill = normalizeBill(res.parsed_output as unknown as RawBill);

    // จับคู่กับแฟ้มหลัก: ผู้จำหน่ายตามเลขผู้เสียภาษี (+สาขา) · รายการตามชื่อสินค้า/ค่าใช้จ่ายที่ตรงกัน
    const sup = bill.supplier.tax_id ? (await sql<{ id: string; code: string; name: string; tax_branch_no: string | null }>`SELECT id, code, name, tax_branch_no FROM md_supplier
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND status = 'A' AND replace(tax_id, '-', '') = ${bill.supplier.tax_id} ORDER BY (tax_branch_no IS NOT DISTINCT FROM ${bill.supplier.branch_no}) DESC, code LIMIT 1`.execute(db)).rows[0] ?? null : null;
    const K = AI_BILL_TARGETS.find((k) => k.path === b.target)!;
    const service = K.service;
    const names = [...new Set(bill.lines.map((l) => l.description.toLowerCase()).filter(Boolean))];
    const items = names.length ? (await sql<{ id: string; code: string; name_th: string; base_unit_id: string | null }>`SELECT id, code, name_th, base_unit_id FROM md_item
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND status = 'A' AND lower(name_th) = ANY(${names}::text[]) AND ${service ? sql`item_type = '5'` : sql`item_type <> '5'`}`.execute(db)).rows : [];
    await logActivity(db, a, { module: K.menu, action: 'AI_READ_BILL', docNo: bill.doc_no || null, detail: { file: b.file_name, cost_usd: cost, supplier: sup?.code ?? null } });
    return {
      bill, supplier: sup,
      lines: bill.lines.map((l) => ({ ...l, item: items.find((i) => i.name_th.toLowerCase() === l.description.toLowerCase()) ?? null })),
      usage: { model: res.model, cost_usd: cost, month_cost_usd: used.cost.plus(cost).toFixed(4), monthly_limit_usd: limit },
    };
  });
}
