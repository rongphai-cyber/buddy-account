import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  checkAllowances, checkPayItem, checkTaxId, checkTaxRules, d, PAY_ITEM_DEFAULTS, PAY_SETTINGS_DEFAULT, SSO_LAW, ssoRateOn, taxRulesFor,
  type PayItemDef, type PaySettings, type PayrollTaxRules, type SsoRate,
} from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { checkOwned } from '../../owned.js';
import { geoCode } from '../../address.js';
import { geoLookup } from '@buddy/core/geo-th';
import { checkAccount } from '../parties.js';
import { companySettings } from '../../company-template.js';

export type Ctx = AuthContext & { companyId: string };
export const uuid = z.string().uuid();
export const optId = uuid.nullable().optional().transform((v) => v ?? null);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
export const optDate = isoDate.nullable().optional().transform((v) => v ?? null);
export const money = z.union([z.number(), z.string()]).transform((v) => String(v === '' ? 0 : v).replace(/,/g, '')).refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'ต้องเป็นตัวเลข');
export const optMoney = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === null || v === undefined || v === '' ? null : String(v).replace(/,/g, ''))).refine((v) => v === null || /^-?\d+(\.\d+)?$/.test(v), 'ต้องเป็นตัวเลข');
export const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb` as never;
const gone = (a: Ctx) => ({ deleted_at: sql`now()` as never, updated_by: a.userId });

// ---------------------------------------------------------------- อัตราตามกฎหมาย
/** กฎภาษีของปี + อัตราประกันสังคม ณ วันที่ (ค่าที่บริษัทกำหนดแทนชนะค่าในโปรแกรม) */
export async function payLaw(db: Db, companyId: string, year: number) {
  const rows = await db.selectFrom('pay_law').select(['kind', 'effective_from', 'rules', 'note']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute();
  const ssoOverrides = rows.filter((r) => r.kind === 'SSO').map((r) => ({ ...(r.rules as SsoRate), effective_from: String(r.effective_from).slice(0, 10) }));
  const tax = rows.find((r) => r.kind === 'TAX' && String(r.effective_from).slice(0, 4) === String(year));
  const { rules, lawYear } = taxRulesFor(year, tax ? (tax.rules as Partial<PayrollTaxRules>) : null, ssoOverrides);
  return { rules, lawYear, taxOverride: !!tax, taxNote: tax?.note ?? null, ssoOverrides, ssoOn: (date: string) => ssoRateOn(date, ssoOverrides) };
}
export async function paySettings(db: Db, companyId: string): Promise<PaySettings & { use_pvd: boolean; sso_employer_no: string; sso_branch_no: string; rd_efiling_user: string }> {
  const s = await companySettings(db, companyId);
  const n = (k: string, def: number) => (Number.isFinite(Number(s[k])) && Number(s[k]) > 0 ? Number(s[k]) : def);
  return {
    hourly_days: n('pay.hourly_days', PAY_SETTINGS_DEFAULT.hourly_days), hourly_hours: n('pay.hourly_hours', PAY_SETTINGS_DEFAULT.hourly_hours), proration_days: n('pay.proration_days', PAY_SETTINGS_DEFAULT.proration_days),
    use_pvd: s['pay.use_pvd'] === true, sso_employer_no: String(s['pay.sso_employer_no'] ?? ''), sso_branch_no: String(s['pay.sso_branch_no'] ?? '000000'), rd_efiling_user: String(s['pay.rd_efiling_user'] ?? ''),
  };
}

// ---------------------------------------------------------------- รายการเงินได้/เงินหัก
/** รหัสแถวคงที่ต่อบริษัท+รหัสรายการ — สำนักงานใหญ่และเครื่องสาขาสร้างรายการเริ่มต้นได้รหัสเดียวกัน (ไม่ชนตอนซิงก์) */
const fixedId = (companyId: string, code: string) => {
  const h = createHash('md5').update(`${companyId}:pay_item:${code}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export type PayItemRow = PayItemDef & { id: string; account_id: string | null; status: string; sort_order: number };
/** รายการของบริษัท (ครั้งแรกสร้างรายการเริ่มต้นให้) */
export async function payItems(db: Db, companyId: string): Promise<PayItemRow[]> {
  const load = () => db.selectFrom('pay_item').select(['id', 'code', 'name_th', 'name_en', 'kind', 'tax_bucket', 'sso_base', 'pvd_base', 'calc', 'multiplier', 'multiplier_daily', 'sign', 'gl_role', 'account_id', 'system_code', 'sort_order', 'status'])
    .where('company_id', '=', companyId).where('deleted_at', 'is', null).orderBy('sort_order').orderBy('code').execute();
  let rows = await load();
  const missing = PAY_ITEM_DEFAULTS.filter((x) => x.system_code && !rows.some((r) => r.system_code === x.system_code));
  if (!rows.length || missing.length) {
    const add = rows.length ? missing : PAY_ITEM_DEFAULTS;
    for (const [i, x] of add.entries()) {
      if (rows.some((r) => r.code === x.code)) continue;
      await db.insertInto('pay_item').values({ id: fixedId(companyId, x.code), company_id: companyId, code: x.code, name_th: x.name_th, name_en: x.name_en ?? null, kind: x.kind, tax_bucket: x.tax_bucket,
        sso_base: x.sso_base, pvd_base: x.pvd_base, calc: x.calc, multiplier: x.multiplier ?? null, multiplier_daily: x.multiplier_daily ?? null, sign: x.sign, gl_role: x.gl_role, system_code: x.system_code ?? null,
        sort_order: (PAY_ITEM_DEFAULTS.indexOf(x) + 1) * 10 || i }).onConflict((oc) => oc.column('id').doNothing()).execute();
    }
    rows = await load();
  }
  return rows.map((r) => ({ ...r, kind: r.kind as PayItemDef['kind'], tax_bucket: r.tax_bucket as PayItemDef['tax_bucket'], calc: r.calc as PayItemDef['calc'], sign: (r.sign === -1 ? -1 : 1) as 1 | -1 }));
}

const itemBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสรายการ').max(20).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'รหัสใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . -'),
  name_th: z.string().trim().min(1, 'ป้อนชื่อรายการ').max(120), name_en: optStr(120),
  kind: z.enum(['E', 'D']), tax_bucket: z.enum(['R', 'S', 'N']).default('N'), sso_base: z.boolean().default(false), pvd_base: z.boolean().default(false),
  calc: z.enum(['AMOUNT', 'WAGE', 'HOURS', 'DAYS', 'MINUTES', 'SYSTEM']).default('AMOUNT'), multiplier: optMoney, multiplier_daily: optMoney, sign: z.union([z.literal(1), z.literal(-1)]).default(1),
  gl_role: z.string().trim().max(30).optional(), account_id: optId, sort_order: z.number().int().min(0).max(99999).optional(), status: z.enum(['A', 'I']).default('A'),
});

// ---------------------------------------------------------------- พนักงาน
const mask = (v: string | null | undefined) => (v ? `•••${v.slice(-4)}` : null);
export const empName = (e: { title?: string | null; first_name: string; last_name?: string | null }) => [e.title, e.first_name].filter(Boolean).join('') + (e.last_name ? ` ${e.last_name}` : '');
export const empBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสพนักงาน').max(20).regex(/^[A-Za-z0-9ก-๙][A-Za-z0-9ก-๙_.-]*$/, 'รหัสพนักงานใช้ได้เฉพาะตัวอักษร ตัวเลข _ . - (ไม่มีช่องว่าง)'),
  title: optStr(30), first_name: z.string().trim().min(1, 'ป้อนชื่อพนักงาน').max(100), last_name: optStr(100), first_name_en: optStr(100), last_name_en: optStr(100), nickname: optStr(60),
  /** undefined = คงค่าเดิม (หน้าจอแสดงแบบปิดบัง) */
  tax_id: z.string().trim().max(20).nullable().optional(),
  gender: z.enum(['M', 'F']).nullable().optional().transform((v) => v ?? null), birth_date: optDate, nationality: optStr(60),
  reg_house_no: optStr(30), reg_moo: optStr(10), reg_village: optStr(100), reg_building: optStr(100), reg_soi: optStr(100), reg_road: optStr(100),
  reg_subdistrict: optStr(100), reg_district: optStr(100), reg_province: optStr(100), reg_postcode: z.string().trim().regex(/^(\d{5})?$/, 'รหัสไปรษณีย์ 5 หลัก').nullable().optional().transform((v) => v || null),
  reg_geo_code: geoCode,
  current_address: optStr(2000), phone: optStr(60), email: optStr(120),
  department_id: optId, branch_id: optId, position: optStr(100), employee_type: optStr(60),
  hire_date: isoDate, end_date: optDate, end_reason: optStr(120),
  pay_method: z.enum(['B', 'C']).default('B'), bank_id: optId,
  bank_account_no: z.string().trim().max(20).nullable().optional(), bank_account_name: optStr(120),
  tax_bearer: z.enum(['W', 'O', 'F', 'N']).default('W'), sso_insured: z.boolean().default(true), sso_hospital: optStr(120),
  pvd_member: z.boolean().default(false), pvd_join_date: optDate, pvd_employee_rate: money.default('0'), pvd_employer_rate: money.default('0'),
  note: optStr(2000), status: z.enum(['A', 'I']).default('A'),
  /** พนักงานใหม่: อัตราค่าจ้างเริ่มต้น (สร้างประวัติค่าจ้าง ณ วันเริ่มงาน) */
  wage_type: z.enum(['M', 'D', 'H']).optional(), rate: optMoney,
});
export type EmpBody = z.infer<typeof empBody>;

function checkEmp(b: EmpBody) {
  if (b.tax_id) {
    const t = b.tax_id.replace(/[\s-]/g, '');
    if (/^\d{13}$/.test(t) && !checkTaxId(t).ok) throw badRequest('เลขประจำตัวประชาชนไม่ถูกต้อง (ตรวจหลักสุดท้ายไม่ผ่าน) — ตรวจเลข 13 หลักจากบัตรอีกครั้ง', [{ field: 'tax_id', message: 'เลขไม่ถูกต้อง' }]);
    if (!/^\d{13}$/.test(t) && !/^[A-Z0-9]{6,20}$/i.test(t)) throw badRequest('เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก (คนต่างชาติใช้เลขหนังสือเดินทาง 6–20 ตัว)', [{ field: 'tax_id', message: '13 หลัก' }]);
  }
  if (b.end_date && b.end_date < b.hire_date) throw badRequest('วันที่ออกต้องไม่ก่อนวันเริ่มงาน', [{ field: 'end_date', message: 'ตรวจวันที่' }]);
  if (b.end_date && !b.end_reason) throw badRequest('ป้อนสาเหตุที่ออก (ใช้ในแบบแจ้งออกประกันสังคม)', [{ field: 'end_reason', message: 'ป้อนสาเหตุ' }]);
  if (b.pay_method === 'B' && b.bank_account_no && !/^\d{10,15}$/.test(b.bank_account_no.replace(/[\s-]/g, ''))) throw badRequest('เลขที่บัญชีธนาคารต้องเป็นตัวเลข 10–15 หลัก', [{ field: 'bank_account_no', message: 'ตัวเลข 10–15 หลัก' }]);
  for (const k of ['pvd_employee_rate', 'pvd_employer_rate'] as const) if (d(b[k]).lt(0) || d(b[k]).gt(15)) throw badRequest('อัตรากองทุนสำรองเลี้ยงชีพต้องอยู่ระหว่าง 0–15%', [{ field: k, message: '0–15%' }]);
  if (b.pvd_member && d(b.pvd_employee_rate).lte(0)) throw badRequest('สมาชิกกองทุนสำรองเลี้ยงชีพต้องมีอัตราเงินสะสม (ลูกจ้าง) อย่างน้อย 2%', [{ field: 'pvd_employee_rate', message: 'ป้อนอัตรา' }]);
}

export async function salarySteps(db: Db, companyId: string, employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, Array<{ id: string; effective_from: string; wage_type: 'M' | 'D' | 'H'; rate: string; reason: string | null }>>();
  const rows = await db.selectFrom('pay_salary').select(['id', 'employee_id', 'effective_from', 'wage_type', 'rate', 'reason']).where('company_id', '=', companyId).where('employee_id', 'in', employeeIds).where('deleted_at', 'is', null).orderBy('effective_from').execute();
  const m = new Map<string, Array<{ id: string; effective_from: string; wage_type: 'M' | 'D' | 'H'; rate: string; reason: string | null }>>();
  for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), { id: r.id, effective_from: String(r.effective_from).slice(0, 10), wage_type: r.wage_type as 'M' | 'D' | 'H', rate: r.rate, reason: r.reason }]);
  return m;
}
async function syncWageType(db: Db, a: Ctx, employeeId: string) {
  const last = (await salarySteps(db, a.companyId, [employeeId])).get(employeeId)?.at(-1);
  if (last) await db.updateTable('pay_employee').set({ wage_type: last.wage_type }).where('id', '=', employeeId).execute();
}
export async function loadEmp(db: Db, a: Ctx, id: string) {
  const e = await db.selectFrom('pay_employee').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!e) throw notFound('พนักงาน');
  return e;
}
/** พนักงานเคยอยู่ในรอบเงินเดือนแล้ว (ลบไม่ได้ — เลิกใช้แทน) */
const usedInRun = async (db: Db, companyId: string, employeeId: string) =>
  !!(await db.selectFrom('pay_run_employee as re').innerJoin('pay_run as r', 'r.id', 're.run_id').select('re.id').where('re.company_id', '=', companyId).where('re.employee_id', '=', employeeId)
    .where('re.deleted_at', 'is', null).where('r.deleted_at', 'is', null).executeTakeFirst());

const allowBody = z.object({ values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) });
const ytdBody = z.object({ through_month: z.number().int().min(1).max(12), regular: money.default('0'), special: money.default('0'), tax: money.default('0'), special_tax: money.default('0'), sso: money.default('0'), pvd: money.default('0'), note: optStr(200) });
const recurBody = z.object({ item_id: uuid, amount: money, from_month: isoDate, to_month: optDate, note: optStr(200) });
const salaryBody = z.object({ effective_from: isoDate, wage_type: z.enum(['M', 'D', 'H']), rate: money, reason: optStr(200) });
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** เพิ่ม/แก้พนักงาน (หน้าจอและการนำเข้าใช้กฎเดียวกัน) — เรียกในทรานแซกชันของผู้เรียกได้ */
export async function saveEmployee(db: Db, a: Ctx, id: string | null, b: EmpBody) {
  checkEmp(b);
  // เลือกตำบลจากรายการทางการ → ชื่อตำบล อำเภอ จังหวัดตามรหัส (ไฟล์ยื่นราชการใช้ชื่อเปล่า · กรุงเทพตัด "เขต")
  const geo = geoLookup(b.reg_geo_code);
  if (geo) b = { ...b, reg_subdistrict: geo.tamb.th, reg_district: geo.amph.th.replace(/^เขต/, ''), reg_province: geo.prov.th, reg_postcode: b.reg_postcode ?? geo.zip };
  await checkOwned(db, a.companyId, [{ table: 'md_department', id: b.department_id, field: 'department_id' }, { table: 'md_bank', id: b.bank_id, field: 'bank_id' }]);
  if (b.branch_id && !(await db.selectFrom('sys_branch').select('id').where('id', '=', b.branch_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบสาขานี้', [{ field: 'branch_id', message: 'เลือกสาขาใหม่' }]);
  const cur = id ? await loadEmp(db, a, id) : null;
  const dup = await db.selectFrom('pay_employee').select('id').where('company_id', '=', a.companyId).where('code', '=', b.code).where('deleted_at', 'is', null).executeTakeFirst();
  if (dup && dup.id !== id) throw conflict(`รหัสพนักงาน ${b.code} มีอยู่แล้ว — ใช้รหัสอื่น`);
  const taxId = b.tax_id === undefined ? cur?.tax_id ?? null : (b.tax_id ? b.tax_id.replace(/[\s-]/g, '').toUpperCase() : null);
  if (taxId) {
    const same = await db.selectFrom('pay_employee').select(['id', 'code']).where('company_id', '=', a.companyId).where('tax_id', '=', taxId).where('deleted_at', 'is', null).where('status', '=', 'A').executeTakeFirst();
    if (same && same.id !== id && b.status === 'A') throw conflict(`เลขประจำตัวประชาชนนี้เป็นของพนักงานรหัส ${same.code} อยู่แล้ว — ตรวจว่าไม่ได้เพิ่มซ้ำ (คนเดิมกลับมาทำงานใหม่ให้แก้ทะเบียนเดิม)`);
  }
  const bankNo = b.bank_account_no === undefined ? cur?.bank_account_no ?? null : (b.bank_account_no ? b.bank_account_no.replace(/[\s-]/g, '') : null);
  if (!id && (b.rate == null || !b.wage_type)) throw badRequest('พนักงานใหม่: ป้อนประเภทค่าจ้างและอัตราค่าจ้าง', [{ field: 'rate', message: 'ป้อนอัตราค่าจ้าง' }]);
  if (!id && d(b.rate).lte(0)) throw badRequest('อัตราค่าจ้างต้องมากกว่า 0', [{ field: 'rate', message: 'มากกว่า 0' }]);
  const { rate, wage_type, tax_id: _t, bank_account_no: _b, ...v } = b;
  const vals = { ...v, tax_id: taxId, bank_account_no: bankNo, updated_by: a.userId };
  const inTx = <T>(f: (tx: Db) => Promise<T>) => (db.isTransaction ? f(db) : db.transaction().execute(f));
  return inTx(async (tx) => {
    let rid = id;
    if (id) await tx.updateTable('pay_employee').set(vals).where('id', '=', id).execute();
    else {
      rid = (await tx.insertInto('pay_employee').values({ ...vals, wage_type: wage_type!, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      await tx.insertInto('pay_salary').values({ company_id: a.companyId, employee_id: rid!, effective_from: b.hire_date, wage_type: wage_type!, rate: d(rate).toFixed(2), reason: 'เริ่มงาน', created_by: a.userId }).execute();
    }
    const before = cur ? Object.fromEntries(Object.entries(cur).filter(([k, x]) => k in vals && k !== 'updated_by' && String(x ?? '') !== String((vals as Record<string, unknown>)[k] ?? '')).map(([k, x]) => [k, k === 'tax_id' || k === 'bank_account_no' ? mask(x as string) : x])) : undefined;
    await logActivity(tx, a, { module: 'PAY', action: id ? 'EDIT' : 'ADD', docNo: b.code, table: 'pay_employee', rowId: rid, detail: before && Object.keys(before).length ? { before } : undefined });
    return { id: rid };
  });
}

export function payrollMasterRoutes(app: FastifyInstance, db: Db) {
  // ---- อัตราตามกฎหมาย
  app.get('/api/v1/pay/law', async (req) => {
    const a = requireCompany(req);
    const year = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }), req.query).year;
    const L = await payLaw(db, a.companyId, year);
    const sso = [...SSO_LAW.map((r) => ({ ...r, source: 'LAW' as const })), ...L.ssoOverrides.map((r) => ({ ...r, source: 'COMPANY' as const }))].sort((x, y) => x.effective_from.localeCompare(y.effective_from));
    return { year, rules: L.rules, law_year: L.lawYear, tax_override: L.taxOverride, tax_note: L.taxNote, sso, sso_now: L.ssoOn(`${year}-12-31`), settings: await paySettings(db, a.companyId) };
  });
  app.put('/api/v1/pay/law/tax/:year', async (req) => {
    const a = requireCompany(req);
    const year = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100) }), req.params).year;
    const b = parse(z.object({ rules: z.object({ expense_rate: z.string(), expense_cap: z.string(), personal: z.string(), brackets: z.array(z.object({ from: z.string(), to: z.string().nullable(), rate: z.string() })).min(1).max(20),
      allowances: z.array(z.record(z.unknown())).max(60), groups: z.record(z.string()), sso_yearly_cap: z.string() }), note: optStr(200) }), req.body);
    const bad = checkTaxRules(b.rules as unknown as PayrollTaxRules);
    if (bad) throw badRequest(bad);
    const from = `${year}-01-01`;
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('pay_law').set(gone(a)).where('company_id', '=', a.companyId).where('kind', '=', 'TAX').where('effective_from', '=', from).where('deleted_at', 'is', null).execute();
      await tx.insertInto('pay_law').values({ company_id: a.companyId, kind: 'TAX', effective_from: from, rules: jsonb(b.rules), note: b.note, created_by: a.userId, updated_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'EDIT', docNo: `อัตราภาษีปี ${year}`, table: 'pay_law', detail: b.rules });
      return { ok: true };
    });
  });
  app.delete('/api/v1/pay/law/tax/:year', async (req) => {
    const a = requireCompany(req);
    const year = parse(z.object({ year: z.coerce.number().int().min(2000).max(2100) }), req.params).year;
    await db.updateTable('pay_law').set(gone(a)).where('company_id', '=', a.companyId).where('kind', '=', 'TAX').where('effective_from', '=', `${year}-01-01`).where('deleted_at', 'is', null).execute();
    await logActivity(db, a, { module: 'PAY', action: 'DELETE', docNo: `อัตราภาษีปี ${year}`, table: 'pay_law' });
    return { ok: true };
  });
  const ssoBody = z.object({ effective_from: isoDate, employee_rate: money, employer_rate: money, wage_min: money, wage_max: money, monthly_min: money, monthly_max: money, note: optStr(200) });
  app.put('/api/v1/pay/law/sso', async (req) => {
    const a = requireCompany(req);
    const b = parse(ssoBody, req.body);
    if (d(b.wage_max).lt(b.wage_min) || d(b.monthly_max).lt(b.monthly_min)) throw badRequest('ค่าสูงสุดต้องไม่น้อยกว่าค่าต่ำสุด');
    if (d(b.employee_rate).gt(15) || d(b.employer_rate).gt(15)) throw badRequest('อัตราเงินสมทบไม่เกิน 15%');
    const { note, effective_from, ...rules } = b;
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('pay_law').set(gone(a)).where('company_id', '=', a.companyId).where('kind', '=', 'SSO').where('effective_from', '=', effective_from).where('deleted_at', 'is', null).execute();
      await tx.insertInto('pay_law').values({ company_id: a.companyId, kind: 'SSO', effective_from, rules: jsonb(rules), note, created_by: a.userId, updated_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'EDIT', docNo: `อัตราประกันสังคม ${effective_from}`, table: 'pay_law', detail: rules });
      return { ok: true };
    });
  });
  app.delete('/api/v1/pay/law/sso/:date', async (req) => {
    const a = requireCompany(req);
    const date = parse(z.object({ date: isoDate }), req.params).date;
    await db.updateTable('pay_law').set(gone(a)).where('company_id', '=', a.companyId).where('kind', '=', 'SSO').where('effective_from', '=', date).where('deleted_at', 'is', null).execute();
    await logActivity(db, a, { module: 'PAY', action: 'DELETE', docNo: `อัตราประกันสังคม ${date}`, table: 'pay_law' });
    return { ok: true };
  });

  // ---- รายการเงินได้/เงินหัก
  app.get('/api/v1/pay/items', async (req) => {
    const a = requireCompany(req);
    const items = await payItems(db, a.companyId);
    const used = new Set((await db.selectFrom('pay_run_line').select('item_id').distinct().where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute()).map((r) => r.item_id));
    const accs = await db.selectFrom('gl_account').select(['id', 'account_no', 'name_th']).where('company_id', '=', a.companyId).where('id', 'in', [...new Set(items.map((x) => x.account_id).filter((x): x is string => !!x)), '00000000-0000-0000-0000-000000000000']).execute();
    return items.map((x) => ({ ...x, used: used.has(x.id), account_no: accs.find((c) => c.id === x.account_id)?.account_no ?? null, account_name: accs.find((c) => c.id === x.account_id)?.name_th ?? null }));
  });
  const saveItem = async (a: Ctx, id: string | null, b: z.infer<typeof itemBody>) => {
    await payItems(db, a.companyId);
    const cur = id ? await db.selectFrom('pay_item').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst() : null;
    if (id && !cur) throw notFound('รายการเงินได้/เงินหัก');
    const isSystem = !!cur?.system_code;
    const x = isSystem ? { ...b, code: cur!.code, kind: cur!.kind as 'E' | 'D', calc: cur!.calc as never, sign: (cur!.sign === -1 ? -1 : 1) as 1 | -1, status: 'A' as const } : b;
    const bad = checkPayItem({ ...x, multiplier: x.multiplier }, isSystem);
    if (bad) throw badRequest(bad);
    if (cur?.system_code === 'TAX' || cur?.system_code === 'SSO' || cur?.system_code === 'PVD') { x.tax_bucket = 'N'; x.sso_base = false; x.pvd_base = false; }
    await checkAccount(db, a.companyId, x.account_id, 'account_id');
    const dup = await db.selectFrom('pay_item').select('id').where('company_id', '=', a.companyId).where('code', '=', x.code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสรายการ ${x.code} มีอยู่แล้ว — ใช้รหัสอื่น`);
    const role = x.gl_role ?? cur?.gl_role ?? (x.kind === 'E' ? 'PAY_BENEFIT' : 'PAY_DEDUCTION_PAYABLE');
    const vals = { code: x.code, name_th: x.name_th, name_en: x.name_en, kind: x.kind, tax_bucket: x.kind === 'D' ? 'N' : x.tax_bucket, sso_base: x.sso_base, pvd_base: x.pvd_base, calc: x.calc,
      multiplier: x.calc === 'HOURS' ? x.multiplier : null, multiplier_daily: x.calc === 'HOURS' ? (x.multiplier_daily ?? x.multiplier) : null, sign: x.sign, gl_role: role, account_id: x.account_id, status: x.status, updated_by: a.userId };
    let rid = id;
    if (id) await db.updateTable('pay_item').set({ ...vals, ...(x.sort_order != null ? { sort_order: x.sort_order } : {}) }).where('id', '=', id).execute();
    else {
      const max = (await db.selectFrom('pay_item').select(sql<number>`coalesce(max(sort_order), 0)`.as('m')).where('company_id', '=', a.companyId).executeTakeFirst())?.m ?? 0;
      rid = (await db.insertInto('pay_item').values({ ...vals, company_id: a.companyId, sort_order: x.sort_order ?? Number(max) + 10, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await logActivity(db, a, { module: 'PAY', action: id ? 'EDIT' : 'ADD', docNo: x.code, table: 'pay_item', rowId: rid, detail: id ? { before: cur } : undefined });
    return { id: rid };
  };
  app.post('/api/v1/pay/items', async (req) => saveItem(requireCompany(req), null, parse(itemBody, req.body)));
  app.put('/api/v1/pay/items/:id', async (req) => saveItem(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(itemBody, req.body)));
  app.delete('/api/v1/pay/items/:id', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const cur = await db.selectFrom('pay_item').select(['code', 'system_code']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!cur) throw notFound('รายการเงินได้/เงินหัก');
    if (cur.system_code) throw badRequest(`รายการ ${cur.code} เป็นรายการของโปรแกรม ลบไม่ได้`);
    const used = await db.selectFrom('pay_run_line').select('id').where('item_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst()
      ?? await db.selectFrom('pay_recurring').select('id').where('item_id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (used) throw badRequest(`รายการ ${cur.code} ใช้ในรอบเงินเดือน/รายการประจำแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.updateTable('pay_item').set(gone(a)).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'PAY', action: 'DELETE', docNo: cur.code, table: 'pay_item', rowId: id });
    return { ok: true };
  });

  // ---- พนักงาน
  app.get('/api/v1/pay/employees', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['A', 'I', 'all']).default('all'), branch_id: optId }), req.query);
    let s = db.selectFrom('pay_employee as e').leftJoin('md_department as dp', 'dp.id', 'e.department_id').leftJoin('sys_branch as b', 'b.id', 'e.branch_id')
      .select(['e.id', 'e.code', 'e.title', 'e.first_name', 'e.last_name', 'e.nickname', 'e.position', 'e.employee_type', 'e.hire_date', 'e.end_date', 'e.wage_type', 'e.status', 'e.tax_id', 'e.department_id', 'e.branch_id',
        'dp.code as department_code', 'dp.name_th as department_name', 'b.code as branch_code', 'b.name as branch_name'])
      .where('e.company_id', '=', a.companyId).where('e.deleted_at', 'is', null);
    if (q.status !== 'all') s = s.where('e.status', '=', q.status);
    if (q.branch_id) s = s.where('e.branch_id', '=', q.branch_id);
    if (q.q) { const k = `%${q.q}%`; s = s.where((eb) => eb.or([eb('e.code', 'ilike', k), eb('e.first_name', 'ilike', k), eb('e.last_name', 'ilike', k), eb('e.nickname', 'ilike', k)])); }
    const rows = await s.orderBy('e.code').limit(5000).execute();
    const steps = await salarySteps(db, a.companyId, rows.map((r) => r.id));
    return rows.map(({ tax_id, ...r }) => ({ ...r, name: empName(r), tax_id_masked: mask(tax_id), rate: steps.get(r.id)?.at(-1)?.rate ?? null }));
  });
  app.get('/api/v1/pay/employees/:id', async (req) => {
    const a = requireCompany(req);
    const e = await loadEmp(db, a, parse(z.object({ id: uuid }), req.params).id);
    const salary = (await salarySteps(db, a.companyId, [e.id])).get(e.id) ?? [];
    const recurring = await db.selectFrom('pay_recurring as r').innerJoin('pay_item as i', 'i.id', 'r.item_id').select(['r.id', 'r.item_id', 'i.code as item_code', 'i.name_th as item_name', 'i.kind', 'r.amount', 'r.from_month', 'r.to_month', 'r.note'])
      .where('r.employee_id', '=', e.id).where('r.company_id', '=', a.companyId).where('r.deleted_at', 'is', null).orderBy('i.sort_order').orderBy('r.from_month').execute();
    const years = await db.selectFrom('pay_allowance').select('tax_year').where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('tax_year').execute();
    const ytd = await db.selectFrom('pay_ytd_opening').selectAll().where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).orderBy('tax_year').execute();
    const { tax_id, bank_account_no, ...rest } = e;
    return { ...rest, name: empName(e), tax_id_masked: mask(tax_id), has_tax_id: !!tax_id, bank_account_masked: mask(bank_account_no), has_bank_account: !!bank_account_no, salary, recurring, allowance_years: years.map((y) => y.tax_year), ytd, used: await usedInRun(db, a.companyId, e.id) };
  });
  app.post('/api/v1/pay/employees/:id/reveal', async (req) => {
    const a = requireCompany(req);
    const e = await loadEmp(db, a, parse(z.object({ id: uuid }), req.params).id);
    await logActivity(db, a, { module: 'PAY', action: 'REVEAL', docNo: e.code, table: 'pay_employee', rowId: e.id, detail: { fields: ['tax_id', 'bank_account_no'] } });
    return { tax_id: e.tax_id, bank_account_no: e.bank_account_no };
  });
  const saveEmp = (a: Ctx, id: string | null, b: EmpBody) => saveEmployee(db, a, id, b);
  app.post('/api/v1/pay/employees', async (req) => saveEmp(requireCompany(req), null, parse(empBody, req.body)));
  app.put('/api/v1/pay/employees/:id', async (req) => saveEmp(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(empBody, req.body)));
  app.delete('/api/v1/pay/employees/:id', async (req) => {
    const a = requireCompany(req);
    const e = await loadEmp(db, a, parse(z.object({ id: uuid }), req.params).id);
    if (await usedInRun(db, a.companyId, e.id)) throw badRequest(`พนักงาน ${e.code} มีรอบเงินเดือนแล้ว ลบไม่ได้ (ต้องเก็บประวัติภาษี) — ใส่วันที่ออกหรือเปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.transaction().execute(async (tx) => {
      for (const t of ['pay_salary', 'pay_allowance', 'pay_recurring', 'pay_ytd_opening'] as const) await tx.updateTable(t).set(gone(a)).where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
      await tx.updateTable('pay_employee').set(gone(a)).where('id', '=', e.id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'DELETE', docNo: e.code, table: 'pay_employee', rowId: e.id });
    });
    return { ok: true };
  });

  // ---- ประวัติค่าจ้าง
  app.post('/api/v1/pay/employees/:id/salary', async (req) => {
    const a = requireCompany(req);
    const e = await loadEmp(db, a, parse(z.object({ id: uuid }), req.params).id);
    const b = parse(salaryBody, req.body);
    if (d(b.rate).lte(0)) throw badRequest('อัตราค่าจ้างต้องมากกว่า 0', [{ field: 'rate', message: 'มากกว่า 0' }]);
    if (b.effective_from < String(e.hire_date).slice(0, 10)) throw badRequest('วันที่มีผลต้องไม่ก่อนวันเริ่มงาน', [{ field: 'effective_from', message: 'ตรวจวันที่' }]);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('pay_salary').set(gone(a)).where('employee_id', '=', e.id).where('effective_from', '=', b.effective_from).where('deleted_at', 'is', null).execute();
      await tx.insertInto('pay_salary').values({ company_id: a.companyId, employee_id: e.id, effective_from: b.effective_from, wage_type: b.wage_type, rate: d(b.rate).toFixed(2), reason: b.reason, created_by: a.userId }).execute();
      await syncWageType(tx, a, e.id);
      await logActivity(tx, a, { module: 'PAY', action: 'SALARY', docNo: e.code, table: 'pay_salary', rowId: e.id, detail: b });
      return { ok: true };
    });
  });
  app.delete('/api/v1/pay/employees/:id/salary/:sid', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, sid: uuid }), req.params);
    const e = await loadEmp(db, a, p.id);
    const steps = (await salarySteps(db, a.companyId, [e.id])).get(e.id) ?? [];
    const s = steps.find((x) => x.id === p.sid);
    if (!s) throw notFound('ประวัติค่าจ้าง');
    if (steps.length <= 1) throw badRequest('ต้องมีอัตราค่าจ้างอย่างน้อย 1 รายการ — แก้อัตราด้วยการเพิ่มรายการใหม่');
    await db.updateTable('pay_salary').set(gone(a)).where('id', '=', s.id).execute();
    await syncWageType(db, a, e.id);
    await logActivity(db, a, { module: 'PAY', action: 'SALARY_DEL', docNo: e.code, table: 'pay_salary', rowId: s.id, detail: s });
    return { ok: true };
  });

  // ---- ค่าลดหย่อนรายปี
  app.get('/api/v1/pay/employees/:id/allowances/:year', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, year: z.coerce.number().int().min(2000).max(2100) }), req.params);
    await loadEmp(db, a, p.id);
    const get = async (y: number) => (await db.selectFrom('pay_allowance').select('allowance_values').where('employee_id', '=', p.id).where('company_id', '=', a.companyId).where('tax_year', '=', y).where('deleted_at', 'is', null).executeTakeFirst())?.allowance_values ?? null;
    const prev = await db.selectFrom('pay_allowance').select(['tax_year', 'allowance_values']).where('employee_id', '=', p.id).where('company_id', '=', a.companyId).where('tax_year', '<', p.year).where('deleted_at', 'is', null).orderBy('tax_year', 'desc').executeTakeFirst();
    return { year: p.year, values: (await get(p.year)) ?? {}, saved: (await get(p.year)) !== null, previous: prev ? { year: prev.tax_year, values: prev.allowance_values } : null, rules: (await payLaw(db, a.companyId, p.year)).rules };
  });
  app.put('/api/v1/pay/employees/:id/allowances/:year', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, year: z.coerce.number().int().min(2000).max(2100) }), req.params);
    const e = await loadEmp(db, a, p.id);
    const values = Object.fromEntries(Object.entries(parse(allowBody, req.body).values).filter(([, v]) => v !== null && v !== '' && v !== false && v !== 0 && v !== '0'));
    const bad = checkAllowances((await payLaw(db, a.companyId, p.year)).rules, values);
    if (bad) throw badRequest(bad);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('pay_allowance').set(gone(a)).where('employee_id', '=', e.id).where('tax_year', '=', p.year).where('deleted_at', 'is', null).execute();
      await tx.insertInto('pay_allowance').values({ company_id: a.companyId, employee_id: e.id, tax_year: p.year, allowance_values: jsonb(values), created_by: a.userId, updated_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'ALLOWANCE', docNo: e.code, table: 'pay_allowance', rowId: e.id, detail: { year: p.year, values } });
      return { ok: true };
    });
  });

  // ---- ยอดยกมาต้นปี
  app.put('/api/v1/pay/employees/:id/ytd/:year', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, year: z.coerce.number().int().min(2000).max(2100) }), req.params);
    const e = await loadEmp(db, a, p.id);
    const b = parse(ytdBody, req.body);
    if (d(b.special_tax).gt(b.tax)) throw badRequest('ภาษีของเงินได้ไม่ประจำต้องไม่เกินภาษีที่หักแล้วทั้งหมด', [{ field: 'special_tax', message: 'ตรวจยอด' }]);
    // ยอดยกมาต้องจบก่อนรอบเงินเดือนแรกในโปรแกรมของปีนั้น
    const first = await db.selectFrom('pay_run_employee as re').innerJoin('pay_run as r', 'r.id', 're.run_id').select(sql<string>`min(r.tax_month)::text`.as('m'))
      .where('re.employee_id', '=', e.id).where('re.company_id', '=', a.companyId).where('re.deleted_at', 'is', null).where('r.deleted_at', 'is', null).where('r.status', '<>', 'C')
      .where('r.tax_month', '>=', `${p.year}-01-01`).where('r.tax_month', '<=', `${p.year}-12-01`).executeTakeFirst();
    if (first?.m && Number(first.m.slice(5, 7)) <= b.through_month) throw badRequest(`มีรอบเงินเดือนในโปรแกรมเดือนที่ ${Number(first.m.slice(5, 7))} แล้ว — ยอดยกมาต้องถึงเดือนก่อนหน้านั้น`, [{ field: 'through_month', message: 'ตรวจเดือน' }]);
    return db.transaction().execute(async (tx) => {
      await tx.updateTable('pay_ytd_opening').set(gone(a)).where('employee_id', '=', e.id).where('tax_year', '=', p.year).where('deleted_at', 'is', null).execute();
      await tx.insertInto('pay_ytd_opening').values({ company_id: a.companyId, employee_id: e.id, tax_year: p.year, ...b, created_by: a.userId, updated_by: a.userId }).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'YTD', docNo: e.code, table: 'pay_ytd_opening', rowId: e.id, detail: { year: p.year, ...b } });
      return { ok: true };
    });
  });
  app.delete('/api/v1/pay/employees/:id/ytd/:year', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, year: z.coerce.number().int().min(2000).max(2100) }), req.params);
    const e = await loadEmp(db, a, p.id);
    await db.updateTable('pay_ytd_opening').set(gone(a)).where('employee_id', '=', e.id).where('tax_year', '=', p.year).where('deleted_at', 'is', null).execute();
    await logActivity(db, a, { module: 'PAY', action: 'YTD_DEL', docNo: e.code, table: 'pay_ytd_opening', rowId: e.id, detail: { year: p.year } });
    return { ok: true };
  });

  // ---- รายการประจำ
  const saveRecur = async (a: Ctx, employeeId: string, rid: string | null, b: z.infer<typeof recurBody>) => {
    const e = await loadEmp(db, a, employeeId);
    const item = (await payItems(db, a.companyId)).find((x) => x.id === b.item_id);
    if (!item) throw badRequest('ไม่พบรายการนี้ — เลือกรายการใหม่', [{ field: 'item_id', message: 'เลือกรายการ' }]);
    if (item.calc !== 'AMOUNT') throw badRequest(`รายการ ${item.code} คิดตาม${item.calc === 'WAGE' ? 'อัตราค่าจ้าง' : 'จำนวน'} — รายการประจำใช้ได้เฉพาะรายการแบบจำนวนเงิน`, [{ field: 'item_id', message: 'เลือกรายการแบบจำนวนเงิน' }]);
    if (d(b.amount).lte(0)) throw badRequest('จำนวนเงินต้องมากกว่า 0', [{ field: 'amount', message: 'มากกว่า 0' }]);
    const from = monthStart(b.from_month), to = b.to_month ? monthStart(b.to_month) : null;
    if (to && to < from) throw badRequest('เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม', [{ field: 'to_month', message: 'ตรวจเดือน' }]);
    const vals = { item_id: b.item_id, amount: d(b.amount).toFixed(2), from_month: from, to_month: to, note: b.note, updated_by: a.userId };
    if (rid) {
      const cur = await db.selectFrom('pay_recurring').select('id').where('id', '=', rid).where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!cur) throw notFound('รายการประจำ');
      await db.updateTable('pay_recurring').set(vals).where('id', '=', rid).execute();
    } else rid = (await db.insertInto('pay_recurring').values({ ...vals, company_id: a.companyId, employee_id: e.id, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'PAY', action: 'RECURRING', docNo: e.code, table: 'pay_recurring', rowId: rid, detail: { item: item.code, ...vals } });
    return { id: rid };
  };
  app.post('/api/v1/pay/employees/:id/recurring', async (req) => saveRecur(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, null, parse(recurBody, req.body)));
  app.put('/api/v1/pay/employees/:id/recurring/:rid', async (req) => { const p = parse(z.object({ id: uuid, rid: uuid }), req.params); return saveRecur(requireCompany(req), p.id, p.rid, parse(recurBody, req.body)); });
  app.delete('/api/v1/pay/employees/:id/recurring/:rid', async (req) => {
    const a = requireCompany(req);
    const p = parse(z.object({ id: uuid, rid: uuid }), req.params);
    const e = await loadEmp(db, a, p.id);
    const r = await db.updateTable('pay_recurring').set(gone(a)).where('id', '=', p.rid).where('employee_id', '=', e.id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw notFound('รายการประจำ');
    await logActivity(db, a, { module: 'PAY', action: 'RECURRING_DEL', docNo: e.code, table: 'pay_recurring', rowId: p.rid });
    return { ok: true };
  });
}
