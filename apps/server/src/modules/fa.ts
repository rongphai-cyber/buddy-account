import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, faAnnual, faEndDate, faRate, faValidate, faYearSchedule, type Decimal, type FaAssetInput } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { checkAccount } from './parties.js';
import { voidJournal } from './cheques.js';
import { createJournal } from './gl/journals.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const optDate = isoDate.nullable().optional().transform((v) => v ?? null);
const money = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v)).refine((v) => !Number.isNaN(Number(v)), 'ต้องเป็นตัวเลข');
const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

/** ทรัพย์สินจากฐานข้อมูล → ข้อมูลสำหรับสูตรค่าเสื่อมใน core */
export type AssetRow = { id: string; code: string; method: string; is_depreciable: boolean; cost: string; salvage_value: string; rate: string | null; useful_life_years: number | null;
  start_date: string; end_date: string | null; sold_date: string | null; depr_monthly: boolean; manual_depr: string; manual_depr_to: string | null; accum_depr_bf: string; accum_bf_date: string | null };
export const toInput = (a: AssetRow): FaAssetInput => ({ method: a.method, is_depreciable: a.is_depreciable, cost: a.cost, salvage_value: a.salvage_value, rate: a.rate, useful_life_years: a.useful_life_years,
  start_date: a.start_date, end_date: a.end_date, sold_date: a.sold_date, depr_monthly: a.depr_monthly, manual_depr: a.manual_depr, manual_depr_to: a.manual_depr_to });
export const ASSET_COLS = sql.raw(`a.id, a.code, a.method, a.is_depreciable, a.cost, a.salvage_value, a.rate, a.useful_life_years, a.start_date::text AS start_date, a.end_date::text AS end_date,
  a.sold_date::text AS sold_date, a.depr_monthly, a.manual_depr, a.manual_depr_to::text AS manual_depr_to, a.accum_depr_bf, a.accum_bf_date::text AS accum_bf_date`);

export type FyPeriods = Array<{ id: string; code: string; start: string; end: string; periods: Array<{ id: string; no: number; start: string; end: string; locked: boolean }> }>;
export async function fiscalYears(db: Db, companyId: string): Promise<FyPeriods> {
  const ys = (await sql<{ id: string; code: string; start: string; end: string }>`SELECT id, code, start_date::text AS start, end_date::text AS "end" FROM gl_fiscal_year
      WHERE company_id = ${companyId} AND deleted_at IS NULL ORDER BY start_date`.execute(db)).rows;
  const ps = (await sql<{ id: string; fy: string; no: number; start: string; end: string; locked: boolean }>`SELECT id, fiscal_year_id AS fy, period_no AS no, start_date::text AS start, end_date::text AS "end", is_locked AS locked
      FROM gl_period WHERE company_id = ${companyId} AND deleted_at IS NULL AND period_no BETWEEN 1 AND 12 ORDER BY start_date`.execute(db)).rows;
  return ys.map((y) => ({ ...y, periods: ps.filter((p) => p.fy === y.id) })).filter((y) => y.periods.length === 12);
}

/** ปีบัญชีถัดไปที่ยังไม่ได้กำหนดรอบบัญชี (ใช้แสดงประมาณการเท่านั้น ลงบัญชีไม่ได้) — งวดเลื่อนจากปีสุดท้าย 1 ปี */
export function withProjectedYears(fys: FyPeriods, untilDate: string): FyPeriods {
  const out = [...fys];
  const shift = (iso: string) => { const y = Number(iso.slice(0, 4)) + 1, m = iso.slice(5, 7), dd = Number(iso.slice(8, 10)); const last = new Date(Date.UTC(y, Number(m), 0)).getUTCDate(); return `${y}-${m}-${String(Math.min(dd, last)).padStart(2, '0')}`; };
  while (out.length && out.at(-1)!.end < untilDate && out.length < fys.length + 5) {
    const l = out.at(-1)!;
    const code = String(Number(l.code) + 1);
    out.push({ id: `proj-${code}`, code, start: shift(l.start), end: shift(l.end), periods: l.periods.map((p) => ({ id: `proj-${code}-${p.no}`, no: p.no, start: shift(p.start), end: shift(p.end), locked: false })) });
  }
  return out;
}

/**
 * ตารางค่าเสื่อมรายงวดของทรัพย์สิน (คำนวณสดตามกฎข้อ 8): ไล่ตั้งแต่ปีของยอดยกมา/วันที่เริ่มใช้ ถึงปีที่ต้องการ
 * งวดที่ลงบัญชีแล้ว (fa_depreciation) ใช้ยอดที่ลงจริง · งวดที่ยังไม่ลงใช้ยอดที่คำนวณ · ค่าเสื่อมสะสมต้นปี = ยกมา + ยอดของงวดก่อนหน้า
 */
export function assetSchedule(a: AssetRow, fys: FyPeriods, posted: Map<string, string>, untilFyIndex: number) {
  const from = a.accum_bf_date ?? a.start_date;
  const out: Array<{ fy: FyPeriods[number]; accBefore: string; months: Array<{ period_id: string; no: number; amount: string; posted: boolean; locked: boolean }> }> = [];
  let acc = d(a.accum_depr_bf);
  for (let i = 0; i <= untilFyIndex && i < fys.length; i++) {
    const fy = fys[i]!;
    if (fy.end < from) continue;
    const calc = faYearSchedule(toInput(a), Number(fy.start.slice(0, 4)), acc.toFixed(2), fy.periods.map((p) => p.start));
    const months = fy.periods.map((p, k) => {
      const pv = posted.get(p.id);
      // ก่อนวันยอดยกมา: รวมอยู่ในยอดยกมาแล้ว
      const amount = pv ?? (p.end < from ? '0.00' : calc[k]!);
      return { period_id: p.id, no: p.no, amount: d(amount).toFixed(2), posted: pv !== undefined, locked: p.locked };
    });
    out.push({ fy, accBefore: acc.toFixed(2), months });
    acc = acc.plus(months.reduce((s, m) => s.plus(m.amount), d(0)));
  }
  return { years: out, accumulated: acc.toFixed(2) };
}

const groupBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสกลุ่มบัญชี').max(10, 'รหัสกลุ่มบัญชีไม่เกิน 10 ตัว'), name_th: z.string().trim().min(1, 'ป้อนคำอธิบาย').max(120), name_en: optStr(120),
  asset_account_id: optId, depr_expense_account_id: optId, accum_depr_account_id: optId,
});
const GROUP_ACCOUNTS = ['asset_account_id', 'depr_expense_account_id', 'accum_depr_account_id'] as const;

const assetBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสทรัพย์สิน').max(30), name_th: z.string().trim().min(1, 'ป้อนชื่อทรัพย์สิน').max(120), name_en: optStr(120),
  category_code: optStr(10), account_group_id: z.string({ required_error: 'เลือกกลุ่มบัญชีทรัพย์สิน' }).uuid('เลือกกลุ่มบัญชีทรัพย์สิน'), serial_no: optStr(40), department_id: optId,
  is_depreciable: z.boolean().default(true), purchase_date: isoDate, cost: money, salvage_value: money.default('1'),
  method: z.enum(['0', '1', '2']).default('1'), start_date: isoDate, useful_life_years: z.coerce.number().int().min(0).max(100).nullable().optional().transform((v) => v || null),
  rate: money.nullable().optional().transform((v) => (v && Number(v) ? v : null)), depr_monthly: z.boolean().default(true),
  accum_depr_bf: money.default('0'), accum_bf_date: optDate, manual_depr: money.default('0'), manual_depr_to: optDate,
});

/** ทรัพย์สินถาวร (คู่มือบทที่ 19 S-FA-01/02) + กลุ่มบัญชีทรัพย์สิน (บทที่ 5 S-SET-12) */
export function faRoutes(app: FastifyInstance, db: Db) {
  // ---------------------------------------------------------------- กลุ่มบัญชีทรัพย์สิน
  app.get('/api/v1/asset-account-groups', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_asset_account_group as g')
      .select(['g.id', 'g.code', 'g.name_th', 'g.name_en', ...GROUP_ACCOUNTS.map((c) => `g.${c}` as const),
        sql<number>`(SELECT count(*) FROM fa_asset x WHERE x.account_group_id = g.id AND x.deleted_at IS NULL)`.as('asset_count')])
      .where('g.company_id', '=', a.companyId).where('g.deleted_at', 'is', null).orderBy('g.code').execute();
  });
  async function saveGroup(a: Ctx, id: string | null, b: z.infer<typeof groupBody>) {
    const code = b.code.toUpperCase();
    const dup = await db.selectFrom('md_asset_account_group').select('id').where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสกลุ่มบัญชี ${code} มีอยู่แล้ว`);
    for (const c of GROUP_ACCOUNTS) await checkAccount(db, a.companyId, b[c], c);
    if (!b.depr_expense_account_id || !b.accum_depr_account_id) throw badRequest('ป้อนบัญชีค่าเสื่อมราคา (Dr.) และบัญชีค่าเสื่อมราคาสะสม (Cr.)', [{ field: b.depr_expense_account_id ? 'accum_depr_account_id' : 'depr_expense_account_id', message: 'ต้องระบุบัญชี' }]);
    const row = { ...b, code };
    if (id) {
      const r = await db.updateTable('md_asset_account_group').set({ ...row, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw notFound('กลุ่มบัญชีทรัพย์สิน');
    } else id = (await db.insertInto('md_asset_account_group').values({ ...row, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'FA', action: dup ? 'EDIT' : 'ADD', docNo: code, table: 'md_asset_account_group', rowId: id });
    return { id };
  }
  app.post('/api/v1/asset-account-groups', async (req) => saveGroup(requireCompany(req), null, parse(groupBody, req.body)));
  app.put('/api/v1/asset-account-groups/:id', async (req) => saveGroup(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(groupBody, req.body)));
  app.delete('/api/v1/asset-account-groups/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const g = await db.selectFrom('md_asset_account_group').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!g) throw notFound('กลุ่มบัญชีทรัพย์สิน');
    const used = await db.selectFrom('fa_asset').select(sql<number>`count(*)`.as('n')).where('company_id', '=', a.companyId).where('account_group_id', '=', id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(used.n)) throw badRequest(`กลุ่มบัญชี ${g.code} ใช้อยู่กับทรัพย์สิน ${Number(used.n).toLocaleString()} รายการ ลบไม่ได้ — ย้ายทรัพย์สินไปกลุ่มอื่นก่อน`);
    await db.updateTable('md_asset_account_group').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'FA', action: 'DELETE', docNo: g.code, table: 'md_asset_account_group', rowId: id });
    return { ok: true };
  });

  // ---------------------------------------------------------------- ทะเบียนทรัพย์สิน
  app.get('/api/v1/fa/assets', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), status: z.enum(['A', 'S', 'all']).default('all'), group: z.string().optional() }), req.query);
    const like = q.q?.trim() ? `%${q.q.trim()}%` : null;
    return (await sql`SELECT a.id, a.code, a.name_th, a.category_code, g.code AS group_code, a.purchase_date, a.cost, a.method, a.rate, a.status, a.sold_date, a.is_depreciable,
          a.accum_depr_bf + coalesce(x.posted, 0) AS accumulated, a.cost - a.accum_depr_bf - coalesce(x.posted, 0) AS book_value
        FROM fa_asset a JOIN md_asset_account_group g ON g.id = a.account_group_id
        LEFT JOIN (SELECT asset_id, sum(amount) AS posted FROM fa_depreciation WHERE company_id = ${a.companyId} AND deleted_at IS NULL GROUP BY asset_id) x ON x.asset_id = a.id
       WHERE a.company_id = ${a.companyId} AND a.deleted_at IS NULL ${q.status !== 'all' ? sql`AND a.status = ${q.status}` : sql``} ${q.group ? sql`AND g.code = ${q.group}` : sql``}
         ${like ? sql`AND (a.code ILIKE ${like} OR a.name_th ILIKE ${like} OR a.name_en ILIKE ${like} OR a.serial_no ILIKE ${like})` : sql``}
       ORDER BY a.code LIMIT 3000`.execute(db)).rows;
  });

  const loadAsset = async (a: Ctx, id: string) => {
    const r = (await sql<AssetRow & Record<string, unknown>>`SELECT ${ASSET_COLS}, a.name_th, a.name_en, a.category_code, a.account_group_id, a.serial_no, a.department_id, a.purchase_date::text AS purchase_date,
        a.sold_amount, a.status, a.created_at, a.updated_at FROM fa_asset a WHERE a.id = ${id} AND a.company_id = ${a.companyId} AND a.deleted_at IS NULL`.execute(db)).rows[0];
    if (!r) throw notFound('ทรัพย์สิน');
    return r;
  };
  app.get('/api/v1/fa/assets/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const x = await loadAsset(a, id);
    const real = await fiscalYears(db, a.companyId);
    const work0 = a.workDate ?? new Date().toISOString().slice(0, 10);
    const curReal = real.find((y) => y.start <= work0 && work0 <= y.end) ?? real.at(-1);
    const fys = curReal ? withProjectedYears(real, `${Number(curReal.end.slice(0, 4)) + 1}${curReal.end.slice(4)}`) : real;
    const posted = new Map((await sql<{ period_id: string; amount: string }>`SELECT period_id, amount FROM fa_depreciation WHERE asset_id = ${id} AND company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows.map((p) => [p.period_id, p.amount]));
    // ปีปัจจุบัน = ปีบัญชีของวันทำการ · แสดงปีปัจจุบันและปีถัดไป (แบบ Express)
    const work = a.workDate ?? new Date().toISOString().slice(0, 10);
    let cur = fys.findIndex((y) => y.start <= work && work <= y.end);
    if (cur < 0) cur = fys.length - 1;
    const s = assetSchedule(x, fys, posted, Math.min(cur + 1, fys.length - 1));
    const show = s.years.filter((y) => fys.indexOf(y.fy) >= cur);
    const accPosted = d(x.accum_depr_bf).plus([...posted.values()].reduce((t, v) => t.plus(v), d(0)));
    const bookValue = d(x.cost).minus(accPosted);
    return { ...x, rate_effective: faRate(toInput(x)).toString(), annual: faAnnual(toInput(x), show[0]?.accBefore ?? x.accum_depr_bf).toFixed(2),
      accumulated: accPosted.toFixed(2), book_value: bookValue.toFixed(2),
      gain_loss: x.sold_date ? d(String(x.sold_amount ?? 0)).minus(bookValue).toFixed(2) : null,
      schedule: show.map((y) => ({ fiscal_year: y.fy.code, start: y.fy.start, end: y.fy.end, projected: y.fy.id.startsWith('proj-'), acc_before: y.accBefore, total: y.months.reduce((t, m) => t.plus(m.amount), d(0)).toFixed(2), months: y.months })) };
  });

  async function saveAsset(a: Ctx, id: string | null, b: z.infer<typeof assetBody>) {
    const code = b.code.toUpperCase();
    const g = await db.selectFrom('md_asset_account_group').select('id').where('id', '=', b.account_group_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!g) throw badRequest('ไม่พบกลุ่มบัญชีทรัพย์สินที่เลือก', [{ field: 'account_group_id', message: 'ไม่พบกลุ่มบัญชี' }]);
    if (b.department_id && !(await db.selectFrom('md_department').select('id').where('id', '=', b.department_id).where('company_id', '=', a.companyId).executeTakeFirst())) throw badRequest('ไม่พบแผนกที่เลือก');
    const method = b.is_depreciable ? b.method : '0';
    const why = faValidate({ ...b, method, sold_date: null });
    if (why) throw badRequest(why);
    if (d(b.accum_depr_bf).gt(d(b.cost).minus(d(b.salvage_value)))) throw badRequest('ค่าเสื่อมสะสมยกมาต้องไม่เกินราคาทุนหักราคาซาก');
    if (d(b.accum_depr_bf).gt(0) && !b.accum_bf_date) throw badRequest('ป้อนวันที่ของค่าเสื่อมสะสมยกมา (ยอดยกมาครอบคลุมถึงก่อนวันนี้)', [{ field: 'accum_bf_date', message: 'ต้องระบุวันที่' }]);
    const row = { ...b, code, method, rate: b.rate ?? (b.useful_life_years ? faRate({ rate: null, useful_life_years: b.useful_life_years }).toFixed(2) : null),
      end_date: faEndDate(b.start_date, b.useful_life_years ?? (b.rate ? Math.round(100 / Number(b.rate)) : null)) };
    const dup = await db.selectFrom('fa_asset').select('id').where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสทรัพย์สิน ${code} มีอยู่แล้ว`);
    if (id) {
      const cur = await db.selectFrom('fa_asset').select(['code', 'sold_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('ทรัพย์สิน');
      if (cur.code !== code) throw badRequest('แก้รหัสทรัพย์สินที่นี่ไม่ได้ — ใช้ "เปลี่ยนรหัสทรัพย์สิน"');
      if (cur.sold_date && String(cur.sold_date) < b.start_date) throw badRequest('วันที่เริ่มใช้ต้องไม่หลังวันที่ขาย');
      await db.updateTable('fa_asset').set({ ...row, updated_by: a.userId }).where('id', '=', id).execute();
    } else id = (await db.insertInto('fa_asset').values({ ...row, company_id: a.companyId, branch_id: a.branchId, status: 'A', created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'FA', action: dup ? 'EDIT' : 'ADD', docNo: code, table: 'fa_asset', rowId: id });
    return { id, code };
  }
  app.post('/api/v1/fa/assets', async (req) => saveAsset(requireCompany(req), null, parse(assetBody, req.body)));
  app.put('/api/v1/fa/assets/:id', async (req) => saveAsset(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(assetBody, req.body)));

  /** เปลี่ยนรหัสทรัพย์สิน (S-FA-02) — ค่าเสื่อมที่ลงแล้วอ้าง id จึงตามไปเอง */
  app.post('/api/v1/fa/assets/:id/recode', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { code } = parse(z.object({ code: z.string().trim().min(1, 'ป้อนรหัสใหม่').max(30) }), req.body);
    const nc = code.toUpperCase();
    const cur = await db.selectFrom('fa_asset').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('ทรัพย์สิน');
    if (cur.code === nc) throw badRequest('รหัสใหม่ซ้ำกับรหัสเดิม');
    if (await db.selectFrom('fa_asset').select('id').where('company_id', '=', a.companyId).where('code', '=', nc).where('deleted_at', 'is', null).executeTakeFirst()) throw conflict(`รหัสทรัพย์สิน ${nc} มีอยู่แล้ว`);
    await db.updateTable('fa_asset').set({ code: nc, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'FA', action: 'RECODE', docNo: nc, table: 'fa_asset', rowId: id, detail: { from: cur.code, to: nc } });
    return { id, code: nc };
  });

  app.delete('/api/v1/fa/assets/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const cur = await db.selectFrom('fa_asset').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('ทรัพย์สิน');
    const n = await db.selectFrom('fa_depreciation').select(sql<number>`count(*)`.as('n')).where('asset_id', '=', id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(n.n)) throw badRequest(`ทรัพย์สิน ${cur.code} ลงค่าเสื่อมแล้ว ${n.n} งวด ลบไม่ได้ — ถ้าขาย/ตัดจำหน่ายให้ใช้ "บันทึกขายทรัพย์สิน"`);
    await db.updateTable('fa_asset').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'FA', action: 'DELETE', docNo: cur.code, table: 'fa_asset', rowId: id });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- คิดค่าเสื่อม-ลงบัญชี (S-FA-04) · ขายทรัพย์สิน (S-FA-03)
type AssetPost = AssetRow & { department_id: string | null; expense_account_id: string | null; accum_account_id: string | null; group_code: string };
async function loadAssetsForPosting(db: Db, companyId: string, ids?: string[]) {
  return (await sql<AssetPost>`SELECT ${ASSET_COLS}, a.department_id, g.code AS group_code, g.depr_expense_account_id AS expense_account_id, g.accum_depr_account_id AS accum_account_id
      FROM fa_asset a JOIN md_asset_account_group g ON g.id = a.account_group_id
     WHERE a.company_id = ${companyId} AND a.deleted_at IS NULL ${ids ? sql`AND a.id IN (${sql.join(ids)})` : sql``} ORDER BY a.code`.execute(db)).rows;
}
async function postedMap(db: Db, companyId: string) {
  const m = new Map<string, Map<string, string>>();
  for (const r of (await sql<{ asset_id: string; period_id: string; amount: string }>`SELECT asset_id, period_id, amount FROM fa_depreciation WHERE company_id = ${companyId} AND deleted_at IS NULL`.execute(db)).rows) {
    if (!m.has(r.asset_id)) m.set(r.asset_id, new Map());
    m.get(r.asset_id)!.set(r.period_id, r.amount);
  }
  return m;
}
/** เลขที่ใบสำคัญค่าเสื่อมแบบ Express: FA + ปี 2 หลัก (ตามระบบปีของบริษัท) + เดือน + ลำดับ 4 หลัก เช่น FA69010001 */
async function faVoucherNo(tx: Db, companyId: string, periodEnd: string, yearSystem: string) {
  const y = Number(periodEnd.slice(0, 4)) + (yearSystem === 'B' ? 543 : 0);
  const prefix = `FA${String(y).slice(-2)}${periodEnd.slice(5, 7)}`;
  const last = (await sql<{ v: string | null }>`SELECT max(voucher_no) AS v FROM gl_journal WHERE company_id = ${companyId} AND voucher_no LIKE ${prefix + '%'} AND length(voucher_no) = ${prefix.length + 4}`.execute(tx)).rows[0]?.v;
  return prefix + String((last ? Number(last.slice(-4)) || 0 : 0) + 1).padStart(4, '0');
}

/**
 * คิดค่าเสื่อมและลงบัญชีรายงวด: recalc = คำนวณใหม่ทุกทรัพย์สินแล้วลงบัญชีแทนของเดิม (RECAL F/A) · post = ลงบัญชีเฉพาะค่าเสื่อมที่คำนวณไว้แต่ยังไม่มีใบสำคัญ (REJNL)
 * งวดเดียวกันมีใบสำคัญค่าเสื่อมใบเดียว (Dr ค่าเสื่อมราคา / Cr ค่าเสื่อมราคาสะสม ตามกลุ่มบัญชี + แผนก) · ยอดไม่เปลี่ยน = ไม่ออกใบใหม่
 */
export async function postDepreciation(db: Db, a: Ctx, periodIds: string[], mode: 'recalc' | 'post', opt: { bookId?: string | null; onlyAssets?: string[] } = {}) {
  const fys = await fiscalYears(db, a.companyId);
  const all = fys.flatMap((y, yi) => y.periods.map((p) => ({ ...p, yi, fy: y })));
  const targets = all.filter((p) => periodIds.includes(p.id)).sort((x, y) => x.start.localeCompare(y.start));
  if (targets.length !== new Set(periodIds).size) throw badRequest('ไม่พบงวดบัญชีที่เลือก');
  const locked = targets.find((p) => p.locked);
  if (locked) throw badRequest(`งวดที่ ${locked.no} ปี ${locked.fy.code} ปิดแล้ว (Message# 1021) — เปิดงวดก่อนคิดค่าเสื่อม`);
  const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
  const book = opt.bookId ? await db.selectFrom('gl_journal_book').select('id').where('id', '=', opt.bookId).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()
    : await db.selectFrom('gl_journal_book').select('id').where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('code').executeTakeFirst();
  if (!book) throw badRequest('ไม่พบสมุดรายวันสำหรับลงค่าเสื่อม — สร้างสมุดรายวันทั่วไปก่อน');
  const assets = await loadAssetsForPosting(db, a.companyId);
  const result: Array<{ period: string; voucher_no: string | null; total: string; changed: boolean }> = [];
  return db.transaction().execute(async (tx) => {
    const posted = await postedMap(tx, a.companyId);
    for (const p of targets) {
      const cur = (await sql<{ id: string; asset_id: string; amount: string; journal_id: string | null; jstatus: string | null }>`SELECT d.id, d.asset_id, d.amount, d.journal_id, j.doc_status AS jstatus
          FROM fa_depreciation d LEFT JOIN gl_journal j ON j.id = d.journal_id WHERE d.company_id = ${a.companyId} AND d.period_id = ${p.id} AND d.deleted_at IS NULL`.execute(tx)).rows;
      let lines: Array<{ asset: AssetPost; amount: string }>;
      if (mode === 'recalc') {
        lines = [];
        for (const x of assets) {
          if (opt.onlyAssets && !opt.onlyAssets.includes(x.id)) { const v = posted.get(x.id)?.get(p.id); if (v) lines.push({ asset: x, amount: v }); continue; }
          const pm = new Map(posted.get(x.id) ?? []); pm.delete(p.id);
          for (const t of targets) if (t.start > p.start) pm.delete(t.id);
          const s = assetSchedule(x, fys, pm, p.yi);
          const v = s.years.find((y) => y.fy.id === p.fy.id)?.months.find((m) => m.period_id === p.id)?.amount ?? '0.00';
          if (!d(v).isZero()) lines.push({ asset: x, amount: v });
          if (!posted.has(x.id)) posted.set(x.id, new Map());
          if (d(v).isZero()) posted.get(x.id)!.delete(p.id); else posted.get(x.id)!.set(p.id, v);
        }
      } else {
        const byId = new Map(assets.map((x) => [x.id, x]));
        lines = cur.filter((r) => byId.has(r.asset_id)).map((r) => ({ asset: byId.get(r.asset_id)!, amount: r.amount }));
      }
      const same = mode === 'post'
        ? cur.length > 0 && cur.every((r) => r.journal_id && r.jstatus === 'N')
        : cur.length === lines.length && lines.every((l) => cur.some((r) => r.asset_id === l.asset.id && d(r.amount).eq(l.amount))) && cur.every((r) => r.journal_id && r.jstatus === 'N');
      const total = lines.reduce((s, l) => s.plus(l.amount), d(0)).toFixed(2);
      if (same || (!lines.length && !cur.length)) { result.push({ period: `${p.fy.code}/${p.no}`, voucher_no: null, total, changed: false }); continue; }
      const missing = lines.find((l) => !l.asset.expense_account_id || !l.asset.accum_account_id);
      if (missing) throw badRequest(`กลุ่มบัญชีทรัพย์สิน ${missing.asset.group_code} (ทรัพย์สิน ${missing.asset.code}) ยังไม่ได้กำหนดบัญชีค่าเสื่อม/ค่าเสื่อมสะสม — แก้ที่เริ่มระบบ › กลุ่มบัญชีทรัพย์สิน`);
      // ยกเลิกใบสำคัญเดิมของงวด (สถานะ C ไม่ลบ) แล้วออกใบใหม่
      const others = (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${a.companyId} AND period_id = ${p.id} AND source_module = 'FA' AND doc_status = 'N' AND deleted_at IS NULL`.execute(tx)).rows.map((r) => r.id);
      for (const jid of new Set([...cur.map((r) => r.journal_id).filter((x): x is string => !!x), ...others])) await voidJournal(tx, a, jid, 'คิดค่าเสื่อมใหม่');
      if (cur.length) await tx.updateTable('fa_depreciation').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', 'in', cur.map((r) => r.id)).execute();
      let jid: string | null = null, vno: string | null = null;
      if (lines.length) {
        const g = new Map<string, { account_id: string; department_id: string | null; debit: Decimal; credit: Decimal }>();
        const add = (acc: string, dep: string | null, side: 'debit' | 'credit', v: string) => {
          const k = `${side}|${acc}|${dep ?? ''}`;
          const e = g.get(k) ?? { account_id: acc, department_id: dep, debit: d(0), credit: d(0) };
          e[side] = e[side].plus(v); g.set(k, e);
        };
        for (const l of lines) { add(l.asset.expense_account_id!, l.asset.department_id, 'debit', l.amount); add(l.asset.accum_account_id!, l.asset.department_id, 'credit', l.amount); }
        const jl = [...g.values()].sort((x, y) => (x.debit.isZero() ? 1 : 0) - (y.debit.isZero() ? 1 : 0)).map((e) => ({ account_id: e.account_id, department_id: e.department_id, debit: e.debit.toFixed(2), credit: e.credit.toFixed(2), description: 'คิดค่าเสื่อมสินทรัพย์ถาวร' }));
        vno = await faVoucherNo(tx, a.companyId, p.end, co.year_system);
        const j = await createJournal(tx, a, { journal_book_id: book.id, voucher_no: vno, voucher_date: p.end, description: 'คิดค่าเสื่อมสินทรัพย์ถาวร', lines: jl } as never, '4', { sourceModule: 'FA' });
        jid = j.id;
        await tx.insertInto('fa_depreciation').values(lines.map((l) => ({ company_id: a.companyId, asset_id: l.asset.id, period_id: p.id, amount: l.amount, journal_id: jid, created_by: a.userId, updated_by: a.userId }))).execute();
      }
      await logActivity(tx, a, { module: 'FA', action: mode === 'recalc' ? 'DEPRECIATE' : 'REPOST', docNo: vno, table: 'fa_depreciation', detail: { period: `${p.fy.code}/${p.no}`, assets: lines.length, total } });
      result.push({ period: `${p.fy.code}/${p.no}`, voucher_no: vno, total, changed: true });
    }
    return result;
  });
}

export function faPostingRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/v1/fa/depreciate', async (req) => {
    const a = requireCompany(req);
    const b = parse(z.object({ period_ids: z.array(uuid).min(1, 'เลือกงวดที่จะคิดค่าเสื่อม').max(24), mode: z.enum(['recalc', 'post']).default('recalc'), journal_book_id: optId }), req.body);
    return { periods: await postDepreciation(db, a, b.period_ids, b.mode, { bookId: b.journal_book_id }) };
  });
  /** งวดที่ลงค่าเสื่อมแล้ว (สำหรับหน้าคิดค่าเสื่อม) */
  app.get('/api/v1/fa/depreciation-periods', async (req) => {
    const a = requireCompany(req);
    return (await sql`SELECT p.id, p.period_no, p.start_date, p.end_date, p.is_locked, y.code AS fiscal_year, x.n, x.total, x.voucher_no, x.journal_id, x.unposted
        FROM gl_period p JOIN gl_fiscal_year y ON y.id = p.fiscal_year_id
        LEFT JOIN (SELECT d.period_id, count(*) AS n, sum(d.amount) AS total, max(j.voucher_no) FILTER (WHERE j.doc_status = 'N') AS voucher_no, (array_agg(j.id ORDER BY j.voucher_no DESC) FILTER (WHERE j.doc_status = 'N'))[1] AS journal_id,
                          count(*) FILTER (WHERE d.journal_id IS NULL OR j.doc_status <> 'N') AS unposted
                     FROM fa_depreciation d LEFT JOIN gl_journal j ON j.id = d.journal_id WHERE d.company_id = ${a.companyId} AND d.deleted_at IS NULL GROUP BY d.period_id) x ON x.period_id = p.id
       WHERE p.company_id = ${a.companyId} AND p.deleted_at IS NULL AND p.period_no BETWEEN 1 AND 12 ORDER BY p.start_date`.execute(db)).rows;
  });
  /** บันทึกขายทรัพย์สิน (S-FA-03): ค่าเสื่อมหยุด ณ วันที่ขาย — งวดที่ลงไว้แล้วหลังวันขายคิดใหม่ · การขาย/จำหน่ายผู้ใช้ลงสมุดรายวันเอง (แบบ Express) */
  const resell = async (a: Ctx, id: string, sold: { sold_date: string | null; sold_amount: string | null }) => {
    const x = await db.selectFrom('fa_asset').select(['code', 'start_date', 'sold_date']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!x) throw notFound('ทรัพย์สิน');
    if (sold.sold_date && sold.sold_date < String(x.start_date).slice(0, 10)) throw badRequest('วันที่ขายต้องไม่ก่อนวันที่เริ่มใช้');
    if (!sold.sold_date && !x.sold_date) throw badRequest('ทรัพย์สินนี้ยังไม่ได้บันทึกขาย');
    const from = [sold.sold_date, x.sold_date ? String(x.sold_date).slice(0, 10) : null].filter((v): v is string => !!v).sort()[0]!;
    const affected = (await sql<{ period_id: string }>`SELECT DISTINCT d.period_id FROM fa_depreciation d JOIN gl_period p ON p.id = d.period_id
        WHERE d.company_id = ${a.companyId} AND d.deleted_at IS NULL AND p.end_date >= ${from}`.execute(db)).rows.map((r) => r.period_id);
    await db.updateTable('fa_asset').set({ sold_date: sold.sold_date, sold_amount: sold.sold_amount, status: sold.sold_date ? 'S' : 'A', updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'FA', action: sold.sold_date ? 'SOLD' : 'UNSOLD', docNo: x.code, table: 'fa_asset', rowId: id, detail: sold });
    const periods = affected.length ? await postDepreciation(db, a, affected, 'recalc', { onlyAssets: [id] }) : [];
    return { id, reposted: periods.filter((p) => p.changed) };
  };
  app.post('/api/v1/fa/assets/:id/sell', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ sold_date: isoDate, sold_amount: money }), req.body);
    return resell(a, id, b);
  });
  app.post('/api/v1/fa/assets/:id/unsell', async (req) => {
    const a = requireCompany(req);
    return resell(a, parse(z.object({ id: uuid }), req.params).id, { sold_date: null, sold_amount: null });
  });
}
