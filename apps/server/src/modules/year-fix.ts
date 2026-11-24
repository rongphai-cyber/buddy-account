import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, forbidden, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

/**
 * ตรวจ/แก้วันที่ปีผิดระบบ (HANDOFF 183 · เจ้าของ 24/11/2569 "แก้ไขเรื่องนี้ก่อน")
 * ก่อนรุ่น 182 บริษัทที่ใช้ ค.ศ. พิมพ์ปี พ.ศ. (เช่น 17/07/2566) แล้วระบบเก็บเป็น ค.ศ. 2566 — วันที่เลื่อนไป 543 ปี
 * ตรวจ: ทุกช่องวันที่/เวลาของทุกตารางที่มี company_id (อ่านจากโครงสร้างฐานข้อมูลตอนทำงาน ตารางใหม่ถูกตรวจด้วยเอง)
 *   ค่าตั้งแต่ 2400-01-01 = ปี พ.ศ. ที่เก็บเป็น ค.ศ. (ค.ศ. 2400 ยังอีกไกล · ตรงกับ yearToCe ใน core)
 *   ไม่ตรวจเวลาที่ระบบเขียนเอง (created_at/updated_at/deleted_at) และตารางบันทึกเหตุการณ์/คิวซิงก์/session
 * แก้: ลบ 543 ปีเฉพาะค่าที่พบ ในทรานแซกชันเดียว (งวดที่ปิดแก้ได้เฉพาะทรานแซกชันนี้) · ไม่ยุบรวม/เดาเมื่อปีบัญชีหรืองวดจะซ้อนกัน — ปฏิเสธพร้อมบอกวิธีแก้
 *   วันสิ้นงวด/สิ้นปีที่เป็นวันสิ้นเดือน ยังเป็นวันสิ้นเดือนหลังย้าย (ก.พ. ปีอธิกสุรทิน) · รหัสปีบัญชีที่ระบบตั้ง (ปีสิ้นสุด + 543) ตั้งใหม่ตามปีที่ถูก
 *   ตรวจงบทดลองรายบัญชีทุกวันที่ ก่อน = หลัง และตรวจซ้ำว่าไม่เหลือวันที่ผิด ไม่ตรง = ยกเลิกทั้งหมด · บันทึก sys_activity_log ทุกช่องที่แก้
 */
export const BE_AS_AD_MIN = '2400-01-01';
const SKIP_TABLES = new Set(['sys_activity_log', 'sync_change_log', 'sync_inbox', 'sync_conflict', 'sys_session', 'sys_ai_usage']);
const SKIP_COLS = new Set(['created_at', 'updated_at', 'deleted_at']);
/** วันสิ้นงวด/สิ้นปี: วันสิ้นเดือนต้องเป็นวันสิ้นเดือนหลังย้ายปี (28 ก.พ. ปีปกติ → 29 ก.พ. ปีอธิกสุรทิน) — ไม่ให้งวดขาดช่วง */
const MONTH_END_COLS = new Set(['gl_fiscal_year.end_date', 'gl_period.end_date', 'pay_run.period_to']);
const LABEL_COLS = ['doc_no', 'voucher_no', 'code', 'cheque_no', 'tax_invoice_no', 'certificate_no', 'period_no', 'name_th', 'display_name', 'name'];
const SAMPLES = 5;

type Col = { t: string; c: string; ty: 'date' | 'ts'; t_th: string; c_th: string; label: string | null };
export type YearFixColumn = { table: string; column: string; table_th: string; column_th: string; count: number; samples: Array<{ label: string | null; before: string; after: string }> };
export type YearFixYear = { id: string; code: string; new_code: string; start_date: string; end_date: string; new_start: string; new_end: string; status: string; conflict: string | null };
export type YearFixScan = { total: number; columns: YearFixColumn[]; fiscal_years: YearFixYear[]; conflicts: string[] };

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** คำอธิบายจาก COMMENT ในโครงสร้าง ("ปีบัญชี | Express: ISPRD | …" → "ปีบัญชี") */
const plain = (desc: string | null, fallback: string) => (desc ?? '').split(' | ')[0]!.replace(/\s*\[.*$/, '').replace(/\s*\(.*$/, '').trim() || fallback;
/** นิพจน์ SQL ของค่าหลังย้าย 543 ปี */
function shifted(col: string, ty: Col['ty'], monthEnd: boolean) {
  if (ty === 'ts') return `(${col} - interval '543 years')`;
  if (!monthEnd) return `(${col} - interval '543 years')::date`;
  return `(CASE WHEN ${col} = (date_trunc('month', ${col}::timestamp) + interval '1 month - 1 day')::date
    THEN (date_trunc('month', (${col} - interval '543 years')::timestamp) + interval '1 month - 1 day')::date ELSE (${col} - interval '543 years')::date END)`;
}
const isWrong = (col: string) => `${col} >= '${BE_AS_AD_MIN}'`;
const fyShift = { s: shifted('y.start_date', 'date', false), e: shifted('y.end_date', 'date', true) };
const pShift = { s: shifted('p.start_date', 'date', false), e: shifted('p.end_date', 'date', true) };

/** ช่องวันที่/เวลาของทุกตารางที่มี company_id (จากโครงสร้างฐานข้อมูลจริง) */
export async function yearFixColumns(db: Db): Promise<Col[]> {
  const rows = (await sql<{ t: string; c: string; ty: string; tdesc: string | null; cdesc: string | null }>`
    SELECT cl.relname AS t, a.attname AS c, a.atttypid::regtype::text AS ty, obj_description(cl.oid, 'pg_class') AS tdesc, col_description(cl.oid, a.attnum) AS cdesc
      FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE cl.relkind IN ('r', 'p') AND a.atttypid IN ('date'::regtype, 'timestamptz'::regtype, 'timestamp'::regtype)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = cl.oid AND x.attname = 'company_id' AND NOT x.attisdropped)
     ORDER BY cl.relname, a.attnum`.execute(db)).rows.filter((r) => !SKIP_TABLES.has(r.t) && !SKIP_COLS.has(r.c));
  const tables = [...new Set(rows.map((r) => r.t))];
  const names = tables.length ? (await sql<{ t: string; c: string }>`SELECT cl.relname AS t, a.attname AS c FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE cl.relname IN (${sql.join(tables)}) AND a.attname IN (${sql.join(LABEL_COLS)})`.execute(db)).rows : [];
  return rows.map((r) => ({
    t: r.t, c: r.c, ty: r.ty === 'date' ? 'date' : 'ts', t_th: plain(r.tdesc, r.t), c_th: plain(r.cdesc, r.c),
    label: LABEL_COLS.find((l) => names.some((x) => x.t === r.t && x.c === l)) ?? null,
  }));
}

/** ตรวจ: จำนวน + ตัวอย่างของแต่ละช่อง · ปีบัญชีที่ผิด + จะซ้อน/ซ้ำไหมหลังย้าย · ใบสำคัญที่ย้ายแล้วไม่มีงวด */
export async function scanYearFix(db: Db, companyId: string, cols?: Col[]): Promise<YearFixScan> {
  const all = cols ?? await yearFixColumns(db);
  const columns: YearFixColumn[] = [];
  for (const col of all) {
    const x = qi(col.c);
    const n = Number((await sql.raw<{ n: string }>(`SELECT count(*)::text AS n FROM ${qi(col.t)} WHERE company_id = '${companyId}'::uuid AND ${isWrong(x)}`).execute(db)).rows[0]!.n);
    if (!n) continue;
    const samples = (await sql.raw<{ label: string | null; before: string; after: string }>(`SELECT ${col.label ? `${qi(col.label)}::text` : 'NULL'} AS label, ${x}::text AS before,
        ${shifted(x, col.ty, MONTH_END_COLS.has(`${col.t}.${col.c}`))}::text AS after FROM ${qi(col.t)}
      WHERE company_id = '${companyId}'::uuid AND ${isWrong(x)} ORDER BY ${x} LIMIT ${SAMPLES}`).execute(db)).rows;
    columns.push({ table: col.t, column: col.c, table_th: col.t_th, column_th: col.c_th, count: n, samples });
  }
  const conflicts: string[] = [];
  const fy = (await sql.raw<YearFixYear & { other: string | null; dup: string | null; mixed: boolean }>(`
    SELECT y.id, y.code, y.status, y.start_date::text AS start_date, y.end_date::text AS end_date, ${fyShift.s}::text AS new_start, ${fyShift.e}::text AS new_end,
           CASE WHEN y.code = (extract(year FROM y.end_date)::int + 543)::text THEN (extract(year FROM ${fyShift.e})::int + 543)::text ELSE y.code END AS new_code,
           NOT (${isWrong('y.start_date')} AND ${isWrong('y.end_date')}) AS mixed,
           (SELECT string_agg(o.code, ', ' ORDER BY o.start_date) FROM gl_fiscal_year o WHERE o.company_id = y.company_id AND o.deleted_at IS NULL AND o.id <> y.id
              AND NOT ${isWrong('o.start_date')} AND NOT ${isWrong('o.end_date')} AND o.start_date <= ${fyShift.e} AND o.end_date >= ${fyShift.s}) AS other,
           NULL::text AS dup, NULL::text AS conflict
      FROM gl_fiscal_year y WHERE y.company_id = '${companyId}'::uuid AND y.deleted_at IS NULL AND (${isWrong('y.start_date')} OR ${isWrong('y.end_date')}) ORDER BY y.start_date`).execute(db)).rows;
  for (const y of fy) {
    const dup = y.code !== y.new_code ? (await sql<{ code: string }>`SELECT code FROM gl_fiscal_year WHERE company_id = ${companyId} AND deleted_at IS NULL AND id <> ${y.id} AND code = ${y.new_code}`.execute(db)).rows[0] : undefined;
    y.conflict = y.mixed ? `ปีบัญชี ${y.code} วันเริ่ม ${y.start_date} กับวันสิ้นปี ${y.end_date} ใช้ระบบปีต่างกัน — แก้วันที่ของปีนี้ที่ เริ่มระบบ › รอบบัญชี ก่อน`
      : y.other ? `ปีบัญชี ${y.code} (${y.start_date} – ${y.end_date}) ย้ายเป็น ${y.new_start} – ${y.new_end} แล้วจะซ้อนกับปีบัญชี ${y.other} ที่มีอยู่ — ไม่รวมให้อัตโนมัติ: ตรวจว่าปีไหนถูก แล้วลบปีที่สร้างผิดหรือย้ายรายการไปปีที่ถูกก่อน (เริ่มระบบ › รอบบัญชี) แล้วตรวจใหม่`
      : dup ? `ปีบัญชี ${y.code} ย้ายแล้วรหัสปีจะเป็น ${y.new_code} ซ้ำกับปีบัญชีที่มีอยู่ — ตรวจปีบัญชี ${y.new_code} ก่อน แล้วตรวจใหม่` : null;
    if (y.conflict) conflicts.push(y.conflict);
  }
  const fiscal_years = fy.map(({ id, code, new_code, start_date, end_date, new_start, new_end, status, conflict: c }) => ({ id, code, new_code, start_date, end_date, new_start, new_end, status, conflict: c }));
  // งวดบัญชีที่ย้ายแล้วซ้อนกับงวดเดิม (กรณีปีบัญชีไม่ซ้อนแต่งวดซ้อน)
  const pOver = (await sql.raw<{ s: string; o: string }>(`SELECT p.start_date::text AS s, string_agg(o.start_date::text, ', ') AS o FROM gl_period p JOIN gl_period o ON o.company_id = p.company_id AND o.deleted_at IS NULL AND o.id <> p.id
       AND NOT ${isWrong('o.start_date')} AND NOT ${isWrong('o.end_date')} AND o.start_date <= ${pShift.e} AND o.end_date >= ${pShift.s}
     WHERE p.company_id = '${companyId}'::uuid AND p.deleted_at IS NULL AND (${isWrong('p.start_date')} OR ${isWrong('p.end_date')}) GROUP BY p.start_date ORDER BY p.start_date LIMIT 5`).execute(db)).rows;
  if (pOver.length && !fy.some((y) => y.other)) conflicts.push(`งวดบัญชีที่เริ่ม ${pOver.map((p) => p.s).join(', ')} ย้ายแล้วจะซ้อนกับงวดที่มีอยู่ — ตรวจรอบบัญชีที่ เริ่มระบบ › รอบบัญชี ก่อน แล้วตรวจใหม่`);
  // ใบสำคัญ/เอกสารที่ย้ายแล้วไม่มีงวดบัญชีรองรับ (งวดที่จะย้ายตามมาก็นับ)
  const covered = (dateExpr: string) => `EXISTS (SELECT 1 FROM gl_period p WHERE p.company_id = '${companyId}'::uuid AND p.deleted_at IS NULL
      AND ${dateExpr} BETWEEN (CASE WHEN ${isWrong('p.start_date')} THEN ${pShift.s} ELSE p.start_date END) AND (CASE WHEN ${isWrong('p.end_date')} THEN ${pShift.e} ELSE p.end_date END))`;
  const noPeriod = (await sql.raw<{ no: string; dt: string }>(`
    SELECT j.voucher_no AS no, ${shifted('j.voucher_date', 'date', false)}::text AS dt FROM gl_journal j WHERE j.company_id = '${companyId}'::uuid AND ${isWrong('j.voucher_date')} AND NOT ${covered(shifted('j.voucher_date', 'date', false))}
    UNION ALL
    SELECT h.doc_no, ${shifted('h.doc_date', 'date', false)}::text FROM doc_header h WHERE h.company_id = '${companyId}'::uuid AND h.period_id IS NOT NULL AND ${isWrong('h.doc_date')} AND NOT ${covered(shifted('h.doc_date', 'date', false))}
    ORDER BY 2 LIMIT 10`).execute(db)).rows;
  if (noPeriod.length) conflicts.push(`${noPeriod.map((r) => `${r.no} (${r.dt})`).join(', ')} ย้ายแล้วไม่มีงวดบัญชีรองรับ — เปิดปีบัญชีของวันนั้นก่อนที่ เริ่มระบบ › รอบบัญชี แล้วตรวจใหม่`);
  // ประวัติที่อยู่: วันที่มีผลซ้ำกับรายการเดิมของสำนักงานใหญ่/สาขาเดียวกัน
  const addr = (await sql.raw<{ dt: string }>(`SELECT ${shifted('h.effective_from', 'date', false)}::text AS dt FROM sys_address_history h WHERE h.company_id = '${companyId}'::uuid AND h.deleted_at IS NULL AND ${isWrong('h.effective_from')}
      AND EXISTS (SELECT 1 FROM sys_address_history o WHERE o.company_id = h.company_id AND o.deleted_at IS NULL AND o.id <> h.id AND o.branch_id IS NOT DISTINCT FROM h.branch_id AND o.effective_from = ${shifted('h.effective_from', 'date', false)})`).execute(db)).rows;
  if (addr.length) conflicts.push(`ประวัติที่อยู่วันที่มีผล ${addr.map((r) => r.dt).join(', ')} ย้ายแล้วซ้ำกับรายการที่มีอยู่ — ลบหรือแก้รายการที่ซ้ำที่ รายละเอียดกิจการ › ประวัติที่อยู่ ก่อน แล้วตรวจใหม่`);
  return { total: columns.reduce((s, c) => s + c.count, 0), columns, fiscal_years, conflicts };
}

/** ยอดรวมรายบัญชีของใบสำคัญทุกวันที่ (ไม่นับที่ยกเลิก/ลบ) — การย้ายวันที่ต้องไม่ทำให้ยอดรายบัญชีเปลี่ยน */
async function balances(db: Db, companyId: string) {
  return (await sql<{ acc: string; dr: string; cr: string }>`SELECT l.account_id::text AS acc, coalesce(sum(l.debit), 0)::text AS dr, coalesce(sum(l.credit), 0)::text AS cr
    FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id WHERE j.company_id = ${companyId} AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL
    GROUP BY l.account_id ORDER BY 1`.execute(db)).rows.map((r) => ({ acc: r.acc, dr: d(r.dr).toFixed(2), cr: d(r.cr).toFixed(2) }));
}
const sumOf = (rows: Array<{ dr: string; cr: string }>) => ({ debit: rows.reduce((s, r) => s.plus(r.dr), d(0)).toFixed(2), credit: rows.reduce((s, r) => s.plus(r.cr), d(0)).toFixed(2) });

const needAdmin = (a: { isAdmin: boolean }) => { if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบของบริษัทใช้เมนูนี้ได้ — ให้ผู้ดูแลระบบเป็นผู้ตรวจ/แก้'); };

export function yearFixRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/tools/year-fix', async (req) => {
    const a = requireCompany(req);
    needAdmin(a);
    return scanYearFix(db, a.companyId);
  });

  app.post('/api/v1/tools/year-fix', async (req) => {
    const a = requireCompany(req);
    needAdmin(a);
    const b = parse(z.object({ expect_total: z.coerce.number().int().min(1) }), req.body);
    try {
      return await db.transaction().execute(async (tx) => {
        // งวดที่ปิดแล้วแก้ได้เฉพาะทรานแซกชันนี้ (แบบเดียวกับคัดลอกบริษัท)
        await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
        const cols = await yearFixColumns(tx);
        const scan = await scanYearFix(tx, a.companyId, cols);
        if (!scan.total) throw badRequest('ไม่พบวันที่ปีผิดระบบแล้ว — ไม่ต้องแก้');
        if (scan.total !== b.expect_total) throw conflict(`ข้อมูลเปลี่ยนไปตั้งแต่ตรวจครั้งก่อน (พบ ${scan.total.toLocaleString()} รายการ ไม่ใช่ ${b.expect_total.toLocaleString()}) — กดตรวจใหม่ แล้วดูรายการก่อนแก้`);
        if (scan.conflicts.length) throw conflict(`ยังแก้ไม่ได้ — ${scan.conflicts.join(' · ')}`);
        const before = await balances(tx, a.companyId);
        const changedJournals = (await sql<{ id: string }>`SELECT id FROM gl_journal WHERE company_id = ${a.companyId} AND voucher_date >= ${BE_AS_AD_MIN}::date`.execute(tx)).rows.map((r) => r.id);
        const changedDocs = (await sql<{ id: string }>`SELECT id FROM doc_header WHERE company_id = ${a.companyId} AND doc_date >= ${BE_AS_AD_MIN}::date`.execute(tx)).rows.map((r) => r.id);
        // รหัสปีบัญชีที่ระบบตั้ง (ปีสิ้นสุด + 543) ตั้งใหม่ก่อนย้ายวันที่
        for (const y of scan.fiscal_years) if (y.new_code !== y.code) await sql`UPDATE gl_fiscal_year SET code = ${y.new_code}, updated_by = ${a.userId} WHERE id = ${y.id} AND company_id = ${a.companyId}`.execute(tx);
        for (const c of scan.columns) {
          const col = cols.find((x) => x.t === c.table && x.c === c.column)!;
          const x = qi(col.c);
          await sql.raw(`UPDATE ${qi(col.t)} SET ${x} = ${shifted(x, col.ty, MONTH_END_COLS.has(`${col.t}.${col.c}`))} WHERE company_id = '${a.companyId}'::uuid AND ${isWrong(x)}`).execute(tx);
        }
        // ใบสำคัญ/เอกสารที่ย้ายวันที่ ชี้งวดที่ครอบคลุมวันที่ใหม่ (งวดที่ย้ายตามมาก็คืองวดเดิม — ไม่เปลี่ยน)
        const repoint = async (t: 'gl_journal' | 'doc_header', dateCol: string, ids: string[], onlyWithPeriod: boolean) => {
          if (!ids.length) return;
          await sql.raw(`UPDATE ${t} x SET period_id = p.id FROM gl_period p WHERE x.company_id = '${a.companyId}'::uuid AND x.id = ANY('{${ids.join(',')}}'::uuid[]) ${onlyWithPeriod ? 'AND x.period_id IS NOT NULL' : ''}
            AND p.company_id = x.company_id AND p.deleted_at IS NULL AND x.${dateCol} BETWEEN p.start_date AND p.end_date AND p.id IS DISTINCT FROM x.period_id`).execute(tx);
        };
        await repoint('gl_journal', 'voucher_date', changedJournals, false);
        await repoint('doc_header', 'doc_date', changedDocs, true);
        const stray = changedJournals.length ? (await sql<{ no: string }>`SELECT j.voucher_no AS no FROM gl_journal j LEFT JOIN gl_period p ON p.id = j.period_id
            WHERE j.id = ANY(${changedJournals}::uuid[]) AND (p.id IS NULL OR j.voucher_date NOT BETWEEN p.start_date AND p.end_date) LIMIT 5`.execute(tx)).rows : [];
        if (stray.length) throw conflict(`ใบสำคัญ ${stray.map((r) => r.no).join(', ')} ย้ายแล้วไม่มีงวดบัญชีรองรับ — ยกเลิกการแก้ทั้งหมด`);
        const left = await scanYearFix(tx, a.companyId, cols);
        if (left.total) throw conflict(`แก้แล้วยังเหลือวันที่ปีผิดระบบ ${left.total} รายการ — ยกเลิกการแก้ทั้งหมด`);
        const after = await balances(tx, a.companyId);
        const key = (r: { acc: string; dr: string; cr: string }) => `${r.acc}:${r.dr}:${r.cr}`;
        const diff = [...before.filter((r) => !after.some((x) => key(x) === key(r))), ...after.filter((r) => !before.some((x) => key(x) === key(r)))];
        const check = { accounts: before.length, same: diff.length === 0, before: sumOf(before), after: sumOf(after), diff };
        if (!check.same) throw conflict('ยอดรายบัญชีหลังย้ายวันที่ไม่เท่าเดิม — ยกเลิกการแก้ทั้งหมด (แจ้งผู้ให้บริการ)');
        for (const c of scan.columns) {
          await logActivity(tx, a, { module: 'SYS', action: 'FIX_YEAR', table: c.table, detail: { column: c.column, count: c.count, minus_years: 543, samples: c.samples } });
        }
        const years = scan.fiscal_years.map(({ code, new_code, start_date, end_date, new_start, new_end }) => ({ code, new_code, start_date, end_date, new_start, new_end }));
        await logActivity(tx, a, { module: 'SYS', action: 'FIX_YEAR', detail: { total: scan.total, columns: scan.columns.map((c) => ({ table: c.table, column: c.column, count: c.count })), fiscal_years: years, check: { accounts: check.accounts, same: check.same, before: check.before, after: check.after } } });
        return { total: scan.total, changed: scan.columns.map(({ samples: _s, ...c }) => c), samples: scan.columns, fiscal_years: years, check };
      });
    } catch (e) {
      const pg = e as { code?: string; constraint?: string };
      if (pg.code === '23505') throw conflict(`ย้ายวันที่แล้วซ้ำกับข้อมูลที่มีอยู่ (${pg.constraint ?? 'ข้อมูลที่ห้ามซ้ำ'}) — ยกเลิกการแก้ทั้งหมด ตรวจรายการที่ซ้ำก่อน แล้วตรวจใหม่`);
      throw e;
    }
  });
}
