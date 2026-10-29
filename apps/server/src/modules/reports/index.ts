import type { FastifyInstance } from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { findReport, formatDate, type ReportResult, type YearSystem } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, notFound, parse, requireCompany, type AuthContext } from '../../http.js';
import { registerReports } from './register.js';
import { partyReports } from './parties.js';

/**
 * ศูนย์รายงาน (คู่มือบทที่ 17) — รายงานทุกตัวรับขอบเขตชุดเดียวกัน คืนผลรูปแบบเดียว (ReportResult) ให้หน้าจอแสดง พิมพ์ ส่งออก
 * ขอบเขต: {key}_from / {key}_to (ช่วงรหัส), date_from/date_to, as_of, period (YYYY-MM), dept (wildcard * ?), ตัวเลือก true/false
 */
export type Ctx = AuthContext & { companyId: string };
export type Params = Record<string, string | boolean | null | undefined>;
export type Runner = (db: Db, a: Ctx, p: P, code: string) => Promise<Omit<ReportResult, 'code' | 'title'> & { title?: string }>;
const RUNNERS = new Map<string, Runner>();
export const defineReport = (codes: string | string[], run: Runner) => { for (const c of [codes].flat()) RUNNERS.set(c, run); };

const validIso = (x: string) => { const t = new Date(x + 'T00:00:00Z'); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === x; };
/** ตัวช่วยอ่านขอบเขต */
export class P {
  constructor(private v: Params, private ys: YearSystem = 'B') {}
  /** วันที่ตามระบบปีของบริษัท (พ.ศ.) สำหรับหัวรายงาน */
  fd(iso: string | null) { return iso ? formatDate(iso, this.ys) : ''; }
  str(k: string) { const x = this.v[k]; return typeof x === 'string' && x.trim() ? x.trim() : null; }
  bool(k: string) { return this.v[k] === true || this.v[k] === 'true' || this.v[k] === 'Y'; }
  date(k: string) {
    const x = this.str(k);
    if (x && (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !validIso(x))) throw badRequest('วันที่ในขอบเขตไม่ถูกต้อง — ตรวจวัน/เดือน');
    return x;
  }
  /** ช่วงวันที่ — ว่างทั้งคู่ = ทั้งหมด */
  dates(k = 'date') { return [this.date(`${k}_from`), this.date(`${k}_to`)] as const; }
  asOf() { return this.date('as_of') ?? new Date().toISOString().slice(0, 10); }
  /** เงื่อนไขช่วงรหัส: col BETWEEN from AND to (ว่าง = ไม่จำกัด) */
  range(k: string, col: RawBuilder<unknown>) {
    const f = this.str(`${k}_from`), t = this.str(`${k}_to`);
    return sql`${f ? sql`AND ${col} >= ${f}` : sql``} ${t ? sql`AND ${col} <= ${t}` : sql``}`;
  }
  dateRange(k: string, col: RawBuilder<unknown>) { const [f, t] = this.dates(k); return sql`${f ? sql`AND ${col} >= ${f}` : sql``} ${t ? sql`AND ${col} <= ${t}` : sql``}`; }
  /** แผนก: * ทุกแผนก, A* ขึ้นต้น A, ?A* ตัวที่ 2 เป็น A (คู่มือหน้า 310) */
  dept(col: RawBuilder<unknown>) {
    const w = this.str('dept');
    if (!w || w === '*') return sql``;
    return sql`AND coalesce(${col}, '') LIKE ${w.replace(/[%_]/g, '\\$&').replace(/\*/g, '%').replace(/\?/g, '_')}`;
  }
  /** ข้อความขอบเขตสำหรับหัวรายงาน */
  describe(labels: Record<string, string>) {
    const out: string[] = [];
    for (const [k, label] of Object.entries(labels)) {
      const isDate = k === 'date' || k.endsWith('date');
      const f = this.str(`${k}_from`), t = this.str(`${k}_to`);
      if (f || t) out.push(`${label} ${f ? (isDate ? this.fd(f) : f) : 'ต้น'} – ${t ? (isDate ? this.fd(t) : t) : 'สุดท้าย'}`);
    }
    return out.join(' · ');
  }
}

export function rptRoutes(app: FastifyInstance, db: Db) {
  registerReports();
  partyReports();
  app.get('/api/v1/rpt/available', async () => ({ codes: [...RUNNERS.keys()] }));
  app.post('/api/v1/rpt/:code/run', async (req) => {
    const a = requireCompany(req);
    const { code } = parse(z.object({ code: z.string().regex(/^[0-9A-Z.]+$/).max(12) }), req.params);
    const def = findReport(code);
    const run = RUNNERS.get(code);
    if (!def || !run) throw notFound('รายงาน');
    const params = parse(z.record(z.union([z.string().max(60), z.boolean(), z.null()])).default({}), (req.body as { params?: unknown } | undefined)?.params ?? {});
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirst();
    const r = await run(db, a, new P(params, (co?.year_system ?? 'B') as YearSystem), code);
    return { code, title: r.title ?? def.title, landscape: def.landscape, ...r } satisfies ReportResult;
  });
}
