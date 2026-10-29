import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { sql } from 'kysely';
import { z } from 'zod';
import { AI_BILL_TARGETS, AI_BUSINESS_TYPES, AI_MODEL, aiCost, BILL_SCHEMA, BILL_SYSTEM_PROMPT, checkTaxId, d, normalizeBill, SUGGEST_SCHEMA, SUGGEST_SYSTEM_PROMPT, suggestPrompt, textSim, type BillDraft, type RawBill, type SuggestCandidate } from '@buddy/core';
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
  const r = (await sql<{ cost: string; n: number }>`SELECT coalesce(sum(cost_usd), 0)::text AS cost, count(*) FILTER (WHERE status = 'OK' AND purpose = 'BILL')::int AS n FROM sys_ai_usage
      WHERE company_id = ${companyId} AND deleted_at IS NULL AND created_at >= date_trunc('month', now())`.execute(db)).rows[0]!;
  return { cost: d(r.cost), count: r.n };
}
async function status(db: Db, companyId: string) {
  const [k, limit, u] = await Promise.all([apiKeyOf(db, companyId), limitOf(db, companyId), monthUsage(db, companyId)]);
  const st = await companySettings(db, companyId);
  return { model: AI_MODEL, has_key: !!k?.key, key_hint: k?.hint ?? null, key_broken: !!k && !k.key, monthly_limit_usd: limit, month_cost_usd: u.cost.toFixed(4), month_count: u.count,
    available: !!k?.key && (limit === null || u.cost.lt(limit)), business_type: (st['ai.business_type'] as string | null) ?? null, guidance: (st['ai.guidance'] as string | null) ?? null };
}

async function record(db: Db, a: AuthContext & { companyId: string }, v: { model?: string | null; usage?: Anthropic.Beta.BetaUsage | null; cost?: string; status: 'OK' | 'ERROR' | 'REFUSED'; file_name: string; file_size: number; message?: string | null; purpose?: 'BILL' | 'SUGGEST' }) {
  await db.insertInto('sys_ai_usage').values({
    company_id: a.companyId, user_id: a.userId, purpose: v.purpose ?? 'BILL', model: v.model ?? null,
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
      business_type: z.enum(Object.keys(AI_BUSINESS_TYPES) as [string, ...string[]]).nullable().optional(),
      guidance: z.string().max(4000, 'แนวทางยาวได้ไม่เกิน 4,000 ตัวอักษร').nullable().optional(),
    }), req.body);
    await db.transaction().execute(async (tx) => {
      if (b.api_key !== undefined) {
        await tx.updateTable('sys_secret').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('company_id', '=', a.companyId).where('code', '=', SECRET).where('deleted_at', 'is', null).execute();
        if (b.api_key) await tx.insertInto('sys_secret').values({ company_id: a.companyId, code: SECRET, value_enc: encryptSecret(b.api_key), hint: `…${b.api_key.slice(-4)}`, created_by: a.userId, updated_by: a.userId }).execute();
      }
      await setSetting(tx, a.companyId, LIMIT_KEY, b.monthly_limit_usd, a.userId);
      if (b.business_type !== undefined) await setSetting(tx, a.companyId, 'ai.business_type', b.business_type, a.userId);
      if (b.guidance !== undefined) await setSetting(tx, a.companyId, 'ai.guidance', b.guidance?.trim() || null, a.userId);
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

    const K = AI_BILL_TARGETS.find((k) => k.path === b.target)!;
    const sc = await checkSupplier(db, a.companyId, bill);
    const dup = sc.supplier && bill.doc_no ? (await sql<{ doc_no: string; doc_class: string; doc_date: string }>`SELECT doc_no, doc_class, doc_date::text AS doc_date FROM doc_header
        WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND doc_status <> 'C' AND supplier_id = ${sc.supplier.id} AND ref_no = ${bill.doc_no} ORDER BY doc_date DESC LIMIT 1`.execute(db)).rows[0] ?? null : null;
    const sg = await suggestLines(db, a, key.key, K.service, bill, sc.supplier, b.file_name, size);
    const total = d(cost).plus(sg.cost).toFixed(4);
    await logActivity(db, a, { module: K.menu, action: 'AI_READ_BILL', docNo: bill.doc_no || null, detail: { file: b.file_name, cost_usd: total, supplier: sc.supplier?.code ?? null, supplier_check: sc.status, duplicate: dup?.doc_no ?? null } });
    return {
      bill, supplier: sc.supplier, supplier_check: { status: sc.status, message: sc.message, candidate: sc.candidate }, duplicate: dup,
      lines: bill.lines.map((l, i) => ({ ...l, ...sg.lines[i]! })), suggest_note: sg.note,
      usage: { model: res.model, cost_usd: total, month_cost_usd: used.cost.plus(total).toFixed(4), monthly_limit_usd: limit },
    };
  });
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
    const s = byTax.find((x) => (x.tax_branch_no ?? null) === (bill.supplier.branch_no ?? null)) ?? byTax[0]!;
    const sim = textSim(bill.supplier.name, s.name);
    if (bill.supplier.name && sim < 0.45) return { supplier: s, status: 'name_mismatch', message: `เลขผู้เสียภาษีตรงกับ ${s.code} ${s.name} แต่ชื่อในบิล "${bill.supplier.name}" ต่างกัน — ตรวจว่าเป็นรายเดียวกัน${badTax}`, candidate: null };
    if (bill.supplier.branch_no && s.tax_branch_no && s.tax_branch_no !== bill.supplier.branch_no) return { supplier: s, status: 'branch_mismatch', message: `ผู้จำหน่าย ${s.code}: สาขาในบิล ${bill.supplier.branch_no} ไม่ตรงกับแฟ้ม (${s.tax_branch_no}) — ภาษีซื้อต้องใช้สาขาตามใบกำกับ`, candidate: null };
    return { supplier: s, status: 'match', message: `ตรงกับผู้จำหน่าย ${s.code} ${s.name} (เลขผู้เสียภาษี${bill.supplier.branch_no ? ` สาขา ${bill.supplier.branch_no}` : ''} ตรงกัน)${badTax}`, candidate: null };
  }
  const near = bill.supplier.name ? all.map((x) => ({ x, sim: textSim(bill.supplier.name, x.name) })).filter((r) => r.sim >= 0.6).sort((p, q) => q.sim - p.sim)[0]?.x ?? null : null;
  if (near) {
    if (!near.tax_id) return { supplier: null, status: 'no_tax', message: `พบผู้จำหน่ายชื่อคล้าย ${near.code} ${near.name} แต่แฟ้มยังไม่มีเลขผู้เสียภาษี${tax ? ` — ถ้าเป็นรายเดียวกัน เพิ่มเลข ${tax} ที่แฟ้มผู้จำหน่าย` : ''}${badTax}`, candidate: near };
    return { supplier: null, status: 'tax_mismatch', message: `ชื่อคล้ายผู้จำหน่าย ${near.code} ${near.name} แต่เลขผู้เสียภาษีในแฟ้ม (${near.tax_id}) ไม่ตรงกับบิล (${tax ?? 'ไม่มี'}) — ตรวจว่าบิลหรือแฟ้มผิด${badTax}`, candidate: near };
  }
  return { supplier: null, status: 'new', message: `ผู้จำหน่ายใหม่ ยังไม่มีในแฟ้ม${tax ? ` (เลขผู้เสียภาษี ${tax})` : ''} — เพิ่มที่ รายละเอียดผู้จำหน่าย ก่อนบันทึก${badTax}`, candidate: null };
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
async function suggestLines(db: Db, a: AuthContext & { companyId: string }, apiKey: string, expenseOnly: boolean, bill: BillDraft, sup: Sup | null, fileName: string, size: number) {
  const types = expenseOnly ? ['5', '2'] : ['0', '1', '2', '3', '5'];
  const cat = (await sql<Cat>`SELECT i.id, i.code, i.name_th, i.item_type, i.remark, i.base_unit_id,
        (SELECT ac.account_no || ' ' || ac.name_th FROM gl_account ac WHERE ac.id = CASE WHEN i.item_type IN ('5', '2') THEN g.inventory_account_id ELSE coalesce(g.purchase_account_id, g.inventory_account_id) END) AS account
      FROM md_item i LEFT JOIN md_item_account_group g ON g.id = i.account_group_id
     WHERE i.company_id = ${a.companyId} AND i.deleted_at IS NULL AND i.status = 'A' AND i.item_type = ANY(${types}::text[]) ORDER BY i.code LIMIT 8000`.execute(db)).rows;
  const byId = new Map(cat.map((c) => [c.id, c])), byCode = new Map(cat.map((c) => [c.code, c]));
  const hist = (await sql<{ description: string | null; item_id: string; supplier_id: string | null }>`SELECT l.description, l.item_id, h.supplier_id FROM doc_line l JOIN doc_header h ON h.id = l.header_id
      WHERE h.company_id = ${a.companyId} AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND h.doc_status <> 'C' AND h.doc_class IN ('RR', 'HP', 'OE') AND l.item_id IS NOT NULL
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
  const expenses = cat.filter((c) => kindOf(c.item_type) === 'expense');
  const expList = (expenses.length <= 200 ? expenses : expenses.map((c) => ({ c, s: Math.max(...bill.lines.map((l) => textSim(l.description, c.name_th))) })).sort((p, q) => q.s - p.s).slice(0, 30).map((x) => x.c));

  // ค่าเริ่มต้น: ประวัติที่คล้ายมาก หรือชื่อรหัสตรงกัน
  const local = (i: number): Suggestion | null => {
    const h = per[i]!.history[0];
    if (h && h.best >= 0.8) return { item: pickOf(h.c), kind: kindOf(h.c.item_type), account: h.c.account, confidence: h.same >= 1 && h.n >= 2 ? 'high' : 'medium', reason: `เคยลงรหัสนี้ ${h.n} ครั้ง${h.same ? ` (กับผู้จำหน่ายนี้ ${h.same} ครั้ง)` : ''}`, source: 'history' };
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
        model: AI_MODEL, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'low', format: jsonSchemaOutputFormat(SUGGEST_SCHEMA as never) },
        system: SUGGEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: suggestPrompt({ businessType: s['ai.business_type'] as string | null, guidance: s['ai.guidance'] as string | null, target: expenseOnly ? 'expense' : 'purchase',
          supplierName: sup?.name ?? bill.supplier.name, supplierKnown: !!sup, lines: bill.lines.map((l, i) => ({ index: i, description: l.description, amount: l.amount, candidates: cand(i) })),
          expenseCodes: expList.map((c) => ({ code: c.code, name: c.name_th, kind: 'expense', account: c.account })) }) }],
      });
      cost = aiCost(res.usage, AI_MODEL, res.model);
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
