import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { applyMapping, cleanImportCell, headerSignature, importMapKey, importSuggestPrompt, IMPORT_DOC_KINDS, mapExpenseImport, mapImport, mapJournalImport, mapPrompt, mapSchema, MAP_SAMPLE_ROWS, MAP_SYSTEM_PROMPT,
  missingCodeRows, normalizeMapping, setImportCodes, SUGGEST_SCHEMA, textSim, type ImportMapping, type ImportMapTarget, type YearSystem } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';
import { allowedFor } from './permissions.js';
import { readTable } from './trade-import.js';
import { aiAvailability, aiStructured } from './ai.js';

/**
 * ให้ AI จัดรูปแบบ Excel ในโปรแกรม (เจ้าของ 20/11/2569 "ทำทาง ก" · HANDOFF 168)
 * analyze: แฟ้มตรงแบบฟอร์มไหม · มีการจับคู่ที่บันทึกไว้ของหัวตารางนี้ไหม (ไม่เสียค่า AI) · แถวต้นแฟ้มให้หน้าจับคู่
 * ai: ส่งเฉพาะหัวตาราง + ตัวอย่าง (ไม่เกิน 25 แถว ช่องละ 60 ตัว) ให้ Claude ตอบ "การจับคู่" — ไม่ส่งทั้งแฟ้ม · กุญแจ/รุ่น/เพดานเดียวกับ AI อ่านบิล
 * save: การจับคู่ที่ผู้ใช้ยืนยัน → sys_setting `imp.map.<ชนิด>.<ลายมือหัวตาราง>` ของบริษัทใน session เท่านั้น
 * suggest: แนะนำรหัสให้แถวที่มีคำอธิบายแต่ไม่มีรหัส — ประวัติของบริษัท + ชื่อรหัสก่อน · AI เฉพาะที่เหลือ (ครั้งเดียว) และเมื่อผู้ใช้กดเท่านั้น
 * นำเข้าจริงใช้การจับคู่กับทุกแถวด้วย applyMapping (core) แล้วเข้าขั้นตรวจ/บันทึกเดิม (trade-import.ts · gl/journal-import.ts — transformTable)
 */
type Ctx = AuthContext & { companyId: string };
export interface MapTarget { path: string; target: ImportMapTarget; cls: string; label: string; menu: string; module: 'AR' | 'AP' | 'GL'; classes: string[] }
export const MAP_TARGETS: MapTarget[] = [
  ...IMPORT_DOC_KINDS.map((k): MapTarget => ({ path: k.path, target: k.cash ? 'expense' : 'trade', cls: k.cls, label: k.label, menu: k.menu, module: k.module,
    classes: k.cash ? ['OE', 'RR', 'HP'] : k.module === 'AR' ? ['IV', 'HS', 'DR', 'CN'] : ['RR', 'HP', 'CP', 'DN'] })),
  { path: 'journal', target: 'journal', cls: 'JV', label: 'ใบสำคัญ (สมุดรายวัน)', menu: 'GL.JNL', module: 'GL', classes: [] },
];
export const mapTargetOf = (path: string) => { const T = MAP_TARGETS.find((t) => t.path === path); if (!T) throw notFound('ชนิดเอกสาร'); return T; };
/** สิทธิ์: เพิ่มใบสำคัญ (สมุดรายวัน) · หรือ นำเข้ารายการขาย/ซื้อ + เพิ่มเอกสารชนิดนั้น */
async function needRights(db: Db, a: Ctx, T: MapTarget) {
  if (T.target === 'journal') { if (!(await allowedFor(db, a, 'GL.JNL', 'add')).allowed) throw forbidden('ไม่มีสิทธิ์เพิ่มใบสำคัญ — นำเข้าไม่ได้'); return; }
  if (!(await allowedFor(db, a, 'OT.IMPTRADE', 'add')).allowed || !(await allowedFor(db, a, T.menu, 'add')).allowed) throw forbidden(`ไม่มีสิทธิ์นำเข้า${T.label}`);
}
const MAX_FILE = 10 * 1024 * 1024;
const fileBody = { target: z.string().max(40), file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(Math.ceil(MAX_FILE * 1.4) + 200, 'แฟ้มใหญ่เกิน 10 MB') };
const tableOf = (b: { file_name: string; data: string }) => readTable(b.file_name, Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64'));
const widthOf = (rows: string[][]) => rows.slice(0, 500).reduce((w, r) => Math.max(w, r.length), 0);
export const mappingBody = z.object({
  header_row: z.number().int(), columns: z.array(z.object({ target: z.string().max(30), source: z.number().int(), constant: z.string().max(200).default('') })).max(60),
  date_order: z.string().max(5), year: z.string().max(5), decimal: z.string().max(6), group: z.string().max(10), skip_words: z.array(z.string().max(60)).max(20).default([]), notes: z.string().max(2000).default(''),
}).passthrough();
/** รหัสที่ผู้ใช้ยอมรับจากคำแนะนำ: เลขแถวในแฟ้ม → รหัส */
export const codesBody = z.record(z.string().regex(/^\d{1,6}$/), z.string().trim().max(30)).optional();

/** แฟ้ม → ตารางตามแบบฟอร์ม: ใช้การจับคู่ (ถ้ามี) + รหัสที่ยอมรับ · ใช้ร่วมกับนำเข้าขาย/ซื้อ/ค่าใช้จ่าย/ใบสำคัญ */
export function transformTable(rows: string[][], target: ImportMapTarget, mapping: unknown, codes: Record<string, string> | undefined) {
  let table = rows, skipped: number[] = [], rowShift = 0;
  if (mapping) { const r = applyMapping(rows, normalizeMapping(mapping as Partial<ImportMapping>, target, widthOf(rows)), target); table = r.table; skipped = r.skipped; rowShift = r.rowShift; }
  if (codes && Object.keys(codes).length) table = setImportCodes(table, target, codes);
  return { table, skipped, rowShift, mapped: !!mapping };
}
/** แฟ้มตรงแบบฟอร์มของ Buddy อยู่แล้ว (หาหัวตารางและคอลัมน์บังคับเจอ) */
function matchesTemplate(rows: string[][], target: ImportMapTarget, ys: YearSystem) {
  const r = target === 'journal' ? mapJournalImport(rows, ys) : target === 'expense' ? mapExpenseImport(rows, ys) : mapImport(rows, ys);
  const n = 'vouchers' in r ? r.vouchers.length : r.docs.length;
  return !(n === 0 && r.errors.length === 1 && /^(ไม่พบหัวตาราง|ไม่มีคอลัมน์)/.test(r.errors[0]!.message));
}

export function importMapRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/v1/import-map/analyze', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object(fileBody), req.body);
    const T = mapTargetOf(b.target);
    await needRights(db, a, T);
    const rows = tableOf(b);
    const width = widthOf(rows);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    // การจับคู่ที่บันทึกไว้: หัวตารางแถวใดก็ได้ใน 20 แถวแรก (แฟ้มบางชุดมีหัวรายงานยาวไม่เท่ากัน) — ของบริษัทนี้เท่านั้น
    const sigs = rows.slice(0, 20).map((r, i) => ({ i, sig: r.some((c) => cleanImportCell(c)) ? headerSignature(r) : null })).filter((x): x is { i: number; sig: string } => !!x.sig);
    const keys = [...new Set(sigs.map((x) => importMapKey(T.cls, x.sig)))];
    const saved = keys.length ? await db.selectFrom('sys_setting').select(['key', 'value', 'updated_at']).where('company_id', '=', a.companyId).where('branch_id', 'is', null).where('deleted_at', 'is', null).where('key', 'in', keys).execute() : [];
    const hit = sigs.find((x) => saved.some((s) => s.key === importMapKey(T.cls, x.sig)));
    const sv = hit ? saved.find((s) => s.key === importMapKey(T.cls, hit.sig))! : null;
    const savedMap = sv ? normalizeMapping({ ...((sv.value as { mapping?: Partial<ImportMapping> }).mapping ?? {}), header_row: hit!.i }, T.target, width) : null;
    return {
      target: T.target, label: T.label, matches: matchesTemplate(rows, T.target, co.year_system as YearSystem), width, total_rows: rows.length,
      preview: rows.slice(0, 40).map((r) => r.map((c) => String(c ?? '').slice(0, 80))),
      saved: savedMap && sv ? { mapping: savedMap, signature: hit!.sig, saved_at: sv.updated_at } : null,
      ai: await aiAvailability(db, a.companyId),
    };
  });

  app.post('/api/v1/import-map/ai', async (req, reply) => {
    const a = requireCompany(req);
    const b = parse(z.object(fileBody), req.body);
    const T = mapTargetOf(b.target);
    await needRights(db, a, T);
    const rows = tableOf(b);
    const sample = rows.slice(0, MAP_SAMPLE_ROWS);
    while (sample.length && !sample[sample.length - 1]!.some((c) => cleanImportCell(c))) sample.pop();
    if (!sample.length) throw badRequest('แฟ้มนี้ไม่มีข้อมูล');
    const r = await aiStructured(db, a, { purpose: 'MAP', file_name: b.file_name, file_size: Math.floor(b.data.length * 3 / 4), system: MAP_SYSTEM_PROMPT, prompt: mapPrompt(T.target, sample, T.label),
      schema: mapSchema(T.target), effort: 'medium', max_tokens: 4000 });
    if (!r.ok) return reply.code(r.status).send({ error: { code: r.code, message: r.message }, usage: r.usage ?? null });
    const mapping = normalizeMapping(r.parsed as Partial<ImportMapping>, T.target, widthOf(rows));
    await logActivity(db, a, { module: T.module, action: 'AI_IMPORT_MAP', detail: { file: b.file_name, target: T.path, cost_usd: r.usage.cost_usd, columns: mapping.columns.length } });
    return { mapping, usage: r.usage };
  });

  app.post('/api/v1/import-map/save', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ target: z.string().max(40), header: z.array(z.string().max(200)).max(200), mapping: mappingBody }), req.body);
    const T = mapTargetOf(b.target);
    await needRights(db, a, T);
    if (!b.header.some((c) => cleanImportCell(c))) throw badRequest('แฟ้มที่ไม่มีหัวตาราง จำการจับคู่ไว้ใช้ครั้งต่อไปไม่ได้ — ใช้ได้เฉพาะแฟ้มนี้');
    const sig = headerSignature(b.header);
    const mapping = normalizeMapping(b.mapping as Partial<ImportMapping>, T.target, 200);
    await setSetting(db, a.companyId, importMapKey(T.cls, sig), { mapping, header: b.header.slice(0, 60).map((c) => c.slice(0, 60)) }, a.userId);
    await logActivity(db, a, { module: T.module, action: 'IMPORT_MAP_SAVE', detail: { target: T.path, signature: sig, columns: mapping.columns.map((c) => c.target) } });
    return { signature: sig };
  });

  app.post('/api/v1/import-map/suggest', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ target: z.string().max(40), use_ai: z.boolean().default(false), file_name: z.string().trim().max(200).default('นำเข้า Excel'),
      items: z.array(z.object({ row: z.number().int().min(1), text: z.string().trim().min(1).max(200), amount: z.string().max(30).default('') })).min(1).max(500) }), req.body);
    const T = mapTargetOf(b.target);
    await needRights(db, a, T);
    return suggestCodes(db, a, T, b.items, b.use_ai, b.file_name);
  });
}

type Cand = { id: string; code: string; name: string };
type Pick = { code: string; name: string; source: 'history' | 'name' | 'ai'; confidence: 'high' | 'medium' | 'low'; reason: string };
/** รหัสที่เลือกได้ + ประวัติการใช้ (คำอธิบาย → รหัส) ของบริษัทนี้เท่านั้น */
async function catalogOf(db: Db, companyId: string, T: MapTarget): Promise<{ cat: Cand[]; hist: Array<{ text: string | null; id: string }>; kind: 'item' | 'expense' | 'account' }> {
  if (T.target === 'journal') {
    const cat = (await sql<Cand>`SELECT id, account_no AS code, name_th AS name FROM gl_account WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'A' AND is_control = false ORDER BY account_no LIMIT 5000`.execute(db)).rows;
    const hist = (await sql<{ text: string | null; id: string }>`SELECT coalesce(l.description, j.description) AS text, l.account_id AS id FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id
        WHERE j.company_id = ${companyId} AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.doc_status <> 'C' AND j.voucher_date >= (current_date - 1095) ORDER BY j.voucher_date DESC LIMIT 4000`.execute(db)).rows;
    return { cat, hist, kind: 'account' };
  }
  const types = T.target === 'expense' ? ['5', '2'] : T.module === 'AR' ? ['0', '1', '2', '3', '4'] : ['0', '1', '2', '3', '5'];
  const cat = (await sql<Cand>`SELECT id, code, name_th AS name FROM md_item WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'A' AND item_type = ANY(${types}::text[]) ORDER BY code LIMIT 8000`.execute(db)).rows;
  const hist = (await sql<{ text: string | null; id: string }>`SELECT l.description AS text, l.item_id AS id FROM doc_line l JOIN doc_header h ON h.id = l.header_id
      WHERE h.company_id = ${companyId} AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND h.doc_status <> 'C' AND h.doc_class = ANY(${T.classes}::text[]) AND l.item_id IS NOT NULL
        AND h.doc_date >= (current_date - 1095) ORDER BY h.doc_date DESC LIMIT 4000`.execute(db)).rows;
  return { cat, hist, kind: T.target === 'expense' ? 'expense' : 'item' };
}

/** แนะนำรหัส: ประวัติ (คำอธิบายคล้าย ≥ 0.8) → ชื่อรหัสตรง (≥ 0.85) → AI เฉพาะที่เหลือ ครั้งเดียว (เมื่อผู้ใช้กด) — ผู้ใช้เลือกยอมรับเอง */
export async function suggestCodes(db: Db, a: Ctx, T: MapTarget, items: Array<{ row: number; text: string; amount: string }>, useAi: boolean, fileName: string) {
  const { cat, hist, kind } = await catalogOf(db, a.companyId, T);
  const byId = new Map(cat.map((c) => [c.id, c])), byCode = new Map(cat.map((c) => [c.code, c]));
  const per = items.map((it) => {
    const agg = new Map<string, { n: number; best: number }>();
    for (const h of hist) {
      const c = byId.get(h.id);
      if (!c) continue;
      const sim = Math.max(textSim(it.text, h.text), textSim(it.text, c.name) * 0.95);
      if (sim < 0.6) continue;
      const g = agg.get(h.id) ?? { n: 0, best: 0 };
      g.n++; g.best = Math.max(g.best, sim); agg.set(h.id, g);
    }
    const history = [...agg.entries()].sort((p, q) => q[1].n - p[1].n || q[1].best - p[1].best).slice(0, 3).map(([id, g]) => ({ c: byId.get(id)!, ...g }));
    const names = cat.map((c) => ({ c, sim: textSim(it.text, c.name) })).filter((x) => x.sim >= 0.3).sort((p, q) => q.sim - p.sim).slice(0, 5);
    const local: Pick | null = history[0] && history[0].best >= 0.8
      ? { code: history[0].c.code, name: history[0].c.name, source: 'history', confidence: history[0].n >= 2 ? 'high' : 'medium', reason: `เคยใช้รหัสนี้ ${history[0].n} ครั้งกับรายการคล้ายกัน` }
      : names[0] && names[0].sim >= 0.85 ? { code: names[0].c.code, name: names[0].c.name, source: 'name', confidence: 'medium', reason: 'ชื่อตรงกับรหัสในแฟ้ม' } : null;
    const alts = [...history.map((h) => h.c), ...names.map((n) => n.c)].filter((x, k, arr) => arr.findIndex((y) => y.id === x.id) === k).slice(0, 5).map((c) => ({ code: c.code, name: c.name }));
    return { local, alts };
  });
  let usage: { model: string; cost_usd: string; month_cost_usd: string; monthly_limit_usd: number | null } | null = null;
  let note: string | null = null;
  const ai = new Map<number, Pick>();
  const left = items.map((it, i) => ({ it, i })).filter((x) => !per[x.i]!.local);
  if (useAi && left.length && cat.length) {
    const s = await companySettings(db, a.companyId);
    const codes = (cat.length <= 200 ? cat : cat.map((c) => ({ c, s: Math.max(...left.map((x) => textSim(x.it.text, c.name))) })).sort((p, q) => q.s - p.s).slice(0, 60).map((x) => x.c)).map((c) => ({ code: c.code, name: c.name }));
    const r = await aiStructured(db, a, { purpose: 'SUGGEST', file_name: fileName, file_size: 0, system: 'คุณช่วยพนักงานบัญชีของกิจการไทยเลือกรหัสให้รายการที่นำเข้าจากแฟ้ม — เลือก code ได้เฉพาะรหัสใน candidates ของบรรทัดนั้นหรือ expense_codes เท่านั้น ไม่มีที่เหมาะ = "" · confidence high/medium/low · reason ภาษาไทยสั้น ๆ ผลเป็นคำแนะนำที่พนักงานบัญชีจะยืนยันเอง',
      prompt: importSuggestPrompt({ businessType: s['ai.business_type'] as string | null, guidance: s['ai.guidance'] as string | null, label: T.label, kind,
        lines: left.map((x, k) => ({ index: k, description: x.it.text, amount: x.it.amount, candidates: per[x.i]!.alts })), codes }),
      schema: SUGGEST_SCHEMA, effort: 'low', max_tokens: 8000 });
    if ('usage' in r && r.usage) usage = r.usage;
    if (r.ok) {
      for (const p of (r.parsed as { lines: Array<{ index: number; code: string; confidence: Pick['confidence']; reason: string }> }).lines ?? []) {
        const x = left[p.index], c = p.code ? byCode.get(p.code) : undefined;
        if (x && c) ai.set(x.i, { code: c.code, name: c.name, source: 'ai', confidence: p.confidence, reason: p.reason.slice(0, 200) });
      }
    } else note = `AI แนะนำรหัสไม่สำเร็จ — ${r.message}`;
  }
  return {
    kind, usage, note, ai_left: left.length - ai.size,
    rows: items.map((it, i) => ({ row: it.row, text: it.text, amount: it.amount, suggestion: per[i]!.local ?? ai.get(i) ?? null, alternatives: per[i]!.alts })),
  };
}
