import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { DB } from './db.js';
import { REPO_ROOT } from './config.js';
import { addMonths, DOC_CLASSES, isoDate, parseIso, STANDARD_DOC_TYPES } from '@buddy/core';

interface ChartTemplate {
  accounts: Array<{ no: string; th: string; en: string | null; parent: string | null; level: number; group: string; control: boolean; side: string; dept: boolean }>;
  default_roles: Record<string, string>;
  journal_books: Array<{ code: string; prefix: string; th: string; en: string | null }>;
}

/** แม่แบบผังบัญชี: express = ผังมาตรฐาน Express · th_en = ผังตัวอย่างไทย–อังกฤษของเจ้าของ (tools/chart/xlsx_chart.py) */
export const CHART_TEMPLATES = { express: 'ผังบัญชีมาตรฐาน (Express)', th_en: 'ผังบัญชีตัวอย่าง ไทย–อังกฤษ' } as const;
export type ChartTemplateKey = keyof typeof CHART_TEMPLATES;
export async function loadChartTemplate(key: ChartTemplateKey = 'express'): Promise<ChartTemplate> {
  return JSON.parse(await readFile(resolve(REPO_ROOT, `db/seed/chart_template_${key}.json`), 'utf8'));
}

/** กฎการลงบัญชี + เส้นทางสมุดรายวัน (db/generated/seed_company_template.sql) สำหรับบริษัท */
export async function applyPostingTemplate(execScript: (s: string) => Promise<void>, companyId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new Error('company id ไม่ถูกต้อง');
  const text = await readFile(resolve(REPO_ROOT, 'db/generated/seed_company_template.sql'), 'utf8');
  await execScript(text.replace(/:'company_id'/g, `'${companyId}'`));
}

/** สร้างปีบัญชี 12 งวดรายเดือน (คู่มือบทที่ 6) */
export async function createFiscalYear(db: Kysely<DB>, companyId: string, startIso: string, userId?: string) {
  const { y, m, d } = parseIso(startIso);
  const start = isoDate(y, m, d);
  const end = addDays(addMonths(start, 12), -1);
  const code = String(parseIso(end).y + 543);
  const exists = await db.selectFrom('gl_fiscal_year').select('id').where('company_id', '=', companyId).where('start_date', '=', start).where('deleted_at', 'is', null).executeTakeFirst();
  if (exists) return exists.id;
  const fy = await db.insertInto('gl_fiscal_year').values({ company_id: companyId, code, start_date: start, end_date: end, status: 'O', created_by: userId ?? null }).returning('id').executeTakeFirstOrThrow();
  for (let i = 0; i < 12; i++) {
    const ps = addMonths(start, i);
    const pe = addDays(addMonths(start, i + 1), -1);
    await db.insertInto('gl_period').values({ company_id: companyId, fiscal_year_id: fy.id, period_no: i + 1, start_date: ps, end_date: pe, created_by: userId ?? null }).execute();
  }
  return fy.id;
}

function addDays(iso: string, n: number) {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** ผังบัญชีมาตรฐาน + บทบาทบัญชี + สมุดรายวัน 00–04 */
export async function seedChart(db: Kysely<DB>, companyId: string, opts: { chart: ChartTemplateKey | null }) {
  const t = await loadChartTemplate(opts.chart ?? 'express');
  for (const b of t.journal_books) {
    await db.insertInto('gl_journal_book').values({ company_id: companyId, code: b.code, prefix: b.prefix, name_th: b.th, name_en: b.en }).onConflict((oc) => oc.doNothing()).execute();
  }
  if (!opts.chart) return;
  const ids = new Map<string, string>();
  for (const a of [...t.accounts].sort((x, y) => x.level - y.level || x.no.localeCompare(y.no))) {
    const r = await db.insertInto('gl_account').values({
      company_id: companyId, account_no: a.no, name_th: a.th, name_en: a.en, parent_id: a.parent ? ids.get(a.parent) ?? null : null,
      level: a.level, account_group: a.group, is_control: a.control, normal_side: a.side, use_department: false, // แม่แบบ: ไม่บังคับแผนก (ตั้งเองภายหลัง)
    }).returning('id').executeTakeFirstOrThrow();
    ids.set(a.no, r.id);
  }
  for (const [role, no] of Object.entries(t.default_roles)) {
    const id = ids.get(no);
    if (id) await db.insertInto('gl_default_account').values({ company_id: companyId, role, account_id: id }).execute();
  }
}

export async function companySettings(db: Kysely<DB>, companyId: string): Promise<Record<string, unknown>> {
  const defs = await db.selectFrom('sys_setting_def').select(['key', 'default_value']).execute();
  const vals = await db.selectFrom('sys_setting').select(['key', 'value']).where('company_id', '=', companyId).where('branch_id', 'is', null).where('deleted_at', 'is', null).execute();
  const out: Record<string, unknown> = {};
  for (const d of defs) out[d.key] = d.default_value;
  for (const v of vals) out[v.key] = v.value;
  return out;
}

export async function setSetting(db: Kysely<DB>, companyId: string, key: string, value: unknown, userId?: string) {
  const module = key.split('.')[0]!.toUpperCase().slice(0, 10);
  const json = JSON.stringify(value);
  const cur = await db.selectFrom('sys_setting').select('id').where('company_id', '=', companyId).where('branch_id', 'is', null).where('key', '=', key).where('deleted_at', 'is', null).executeTakeFirst();
  if (cur) await db.updateTable('sys_setting').set({ value: sql`${json}::jsonb`, updated_by: userId ?? null }).where('id', '=', cur.id).execute();
  else await db.insertInto('sys_setting').values({ company_id: companyId, branch_id: null, module, key, value: sql`${json}::jsonb`, created_by: userId ?? null }).execute();
}

/** ประเภทเอกสารมาตรฐาน (คู่มือบทที่ 9) สำหรับบริษัทใหม่ — สมุดรายวันตามรหัส 00–04 ที่สร้างพร้อมบริษัท */
export async function seedDocTypes(db: Kysely<DB>, companyId: string) {
  const books = new Map((await db.selectFrom('gl_journal_book').select(['id', 'code']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()).map((b) => [b.code, b.id]));
  for (const t of STANDARD_DOC_TYPES) {
    await db.insertInto('md_doc_type').values({ company_id: companyId, code: t.code, doc_class: t.cls, module: DOC_CLASSES[t.cls]?.module ?? 'GL', name_th: t.th, name_en: t.en,
      journal_book_id: t.book ? books.get(t.book) ?? null : null, is_tax_invoice: ['IV', 'HS', 'DR', 'CN', 'AI', 'RE'].includes(t.cls) }).onConflict((oc) => oc.doNothing()).execute();
  }
}
