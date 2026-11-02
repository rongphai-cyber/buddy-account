import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  bankCsv, d, efilingName, efilingProblems, efilingText, EMP_IMPORT_COLUMNS, mapEmployeeImport, mapRunImport, pnd1Rows, rdPrepName, rdPrepText, rdProblems, round2,
  ssoFileName, ssoFileProblems, ssoForm, tis620, type RdPerson, type TaxBearer, type YearSystem,
} from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, conflict, notFound, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { checkAccount } from '../parties.js';
import { periodFor } from '../gl/journals.js';
import { voidJournal } from '../cheques.js';
import { readTable } from '../trade-import.js';
import { buildXls } from '../../xls.js';
import { buildXlsx } from '../../xlsx.js';
import { empBody, empName, loadEmp, payItems, payLaw, paySettings, saveEmployee, uuid, type Ctx } from './master.js';
import { addrOf, draftCount, employees, endOfMonth, payer, totalsBy, yearTotals } from './forms.js';
import { bookFor, calcCtx, calcEmployee, loadRun, mustDraft, nextPayNo, totals, writeJournal } from './runs.js';

/**
 * ระบบเงินเดือน ระยะ 3: นำเข้า (พนักงาน · ยอดประจำงวด) · แฟ้มยื่น (RD Prep · e-Filing v2.0 · e-Service ประกันสังคม .xls) · ไฟล์โอนธนาคาร
 * · บันทึกการยื่น/นำส่ง (ใบสำคัญนำส่ง Dr หนี้สินค้างจ่าย / Cr เงินฝาก + ล็อกเดือน)
 */
const monthQ = z.string().regex(/^\d{4}-\d{2}$/, 'เลือกเดือน');
const yearQ = z.coerce.number().int().min(2000).max(2100);
const optUuid = uuid.optional().or(z.literal('').transform(() => undefined));
const uploadBody = z.object({ file_name: z.string().trim().min(1).max(200), data: z.string().min(1, 'เลือกแฟ้ม').max(15_000_000, 'แฟ้มใหญ่เกิน 10 MB'), commit: z.boolean().default(false) });
const send = (reply: FastifyReply, type: string, name: string, body: Buffer | string) =>
  reply.header('content-type', type).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(body);
const problems = (list: string[]) => { if (list.length) throw badRequest(`สร้างแฟ้มไม่ได้ — แก้ ${list.length} รายการก่อน: ${list.slice(0, 8).join(' · ')}${list.length > 8 ? ' …' : ''}`, list.map((m) => ({ message: m }))); };

/** แถว ภ.ง.ด.1 / 1ก สำหรับแฟ้ม (เลขเต็ม + ที่อยู่แยกส่วน) */
async function rdRows(db: Db, companyId: string, q: { month?: string; year?: number; branch_id?: string }) {
  const annual = !q.month;
  const t = annual ? await yearTotals(db, companyId, q.year!, q.branch_id) : await totalsBy(db, companyId, `${q.month}-01`, `${q.month}-01`, q.branch_id);
  const emps = new Map((await employees(db, companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
  const r = pnd1Rows(t.map((x) => { const e = emps.get(x.employee_id)!; return { employee_id: e.id, code: e.code, title: e.title, first_name: e.first_name, last_name: e.last_name, tax_id: e.tax_id, bearer: e.tax_bearer as TaxBearer,
    pay_date: annual ? `${q.year}-12-31` : x.pay_date <= endOfMonth(q.month!) ? x.pay_date : endOfMonth(q.month!), totals: x }; }));
  const rows: RdPerson[] = r.rows.map((x) => ({ no: x.no, tax_id: x.tax_id, title: x.title, first_name: x.first_name, last_name: x.last_name, pay_date: x.pay_date, income: x.income, tax: x.tax, condition: x.condition, addr: addrOf(emps.get(x.employee_id)!) }));
  return { rows, income: r.income, tax: r.tax, count: r.count };
}
const branch6 = (no: string) => no.replace(/\D/g, '').padStart(6, '0').slice(-6);

export function payrollFileRoutes(app: FastifyInstance, db: Db) {
  // ---- แฟ้ม RD Prep (UTF-8 หรือ TIS-620)
  const rdPrep = async (a: Ctx, q: { month?: string; year?: number; branch_id?: string; enc: 'utf8' | 'tis620' }, reply: FastifyReply) => {
    const r = await rdRows(db, a.companyId, q);
    if (!r.rows.length) throw badRequest('ไม่มีเงินได้ในช่วงนี้ (หรือรอบเงินเดือนยังเป็นร่าง) — ไม่มีอะไรให้ยื่น');
    problems(rdProblems(r.rows, !q.month));
    const p = await payer(db, a.companyId, q.branch_id);
    if (!p.tax_id) throw badRequest('ยังไม่ได้ใส่เลขประจำตัวผู้เสียภาษีของบริษัท — แก้ที่ เริ่มระบบ › รายละเอียดกิจการ');
    const year = q.month ? Number(q.month.slice(0, 4)) : q.year!;
    const text = rdPrepText(r.rows, !q.month, year);
    await logActivity(db, a, { module: 'PAY', action: 'EXPORT', docNo: q.month ? `ภ.ง.ด.1 ${q.month}` : `ภ.ง.ด.1ก ${year}`, table: 'pay_run', detail: { file: 'RD Prep', rows: r.count } });
    return send(reply, 'text/plain; charset=' + (q.enc === 'tis620' ? 'windows-874' : 'utf-8'), rdPrepName(p.tax_id, branch6(p.branch_no), year, q.month ? Number(q.month.slice(5, 7)) : null), q.enc === 'tis620' ? Buffer.from(tis620(text)) : Buffer.from(text, 'utf8'));
  };
  app.get('/api/v1/pay/pnd1/rdprep', async (req, reply) => { const q = parse(z.object({ month: monthQ, branch_id: optUuid, enc: z.enum(['utf8', 'tis620']).default('utf8') }), req.query); return rdPrep(requireCompany(req), q, reply); });
  app.get('/api/v1/pay/pnd1a/rdprep', async (req, reply) => { const q = parse(z.object({ year: yearQ, branch_id: optUuid, enc: z.enum(['utf8', 'tis620']).default('utf8') }), req.query); return rdPrep(requireCompany(req), q, reply); });

  // ---- แฟ้ม e-Filing FORMAT กลาง v2.0
  const efiling = async (a: Ctx, q: { month?: string; year?: number; branch_id?: string; filing_no: number; channel: 'internet' | 'media' }, reply: FastifyReply) => {
    const r = await rdRows(db, a.companyId, q);
    if (!r.rows.length) throw badRequest('ไม่มีเงินได้ในช่วงนี้ (หรือรอบเงินเดือนยังเป็นร่าง) — ไม่มีอะไรให้ยื่น');
    const p = await payer(db, a.companyId, q.branch_id);
    const s = await paySettings(db, a.companyId);
    const year = q.month ? Number(q.month.slice(0, 4)) : q.year!;
    const h = { company_tax_id: p.tax_id ?? '', branch6: branch6(p.branch_no), branch_name: p.branch_name, form: (q.month ? 'PND1' : 'PND1A') as 'PND1' | 'PND1A', year, month: q.month ? Number(q.month.slice(5, 7)) : null,
      filing_no: q.filing_no, internet: q.channel === 'internet', efiling_user: s.rd_efiling_user };
    problems([...efilingProblems(h), ...rdProblems(r.rows, !q.month)]);
    await logActivity(db, a, { module: 'PAY', action: 'EXPORT', docNo: `${h.form} ${q.month ?? year}`, table: 'pay_run', detail: { file: 'e-Filing v2.0', rows: r.count, filing_no: q.filing_no } });
    return send(reply, 'text/plain; charset=utf-8', efilingName(h), Buffer.from(efilingText(h, r.rows), 'utf8'));
  };
  const efQ = { branch_id: optUuid, filing_no: z.coerce.number().int().min(0).max(9).default(0), channel: z.enum(['internet', 'media']).default('internet') };
  app.get('/api/v1/pay/pnd1/efiling', async (req, reply) => efiling(requireCompany(req), parse(z.object({ month: monthQ, ...efQ }), req.query), reply));
  app.get('/api/v1/pay/pnd1a/efiling', async (req, reply) => efiling(requireCompany(req), parse(z.object({ year: yearQ, ...efQ }), req.query), reply));

  // ---- แฟ้ม e-Service ประกันสังคม (.xls · ค่าจ้างจ่ายจริงไม่ตัดเพดาน)
  app.get('/api/v1/pay/sso/file', async (req, reply) => {
    const a = requireCompany(req);
    const q = parse(z.object({ month: monthQ, branch_id: optUuid }), req.query);
    const from = `${q.month}-01`;
    const t = (await totalsBy(db, a.companyId, from, from, q.branch_id)).filter((x) => d(x.sso_ee).gt(0) || d(x.sso_er).gt(0));
    if (!t.length) throw badRequest('ไม่มีเงินสมทบในเดือนนี้ (หรือรอบเงินเดือนยังเป็นร่าง)');
    const emps = new Map((await employees(db, a.companyId, t.map((x) => x.employee_id))).map((e) => [e.id, e]));
    const law = await payLaw(db, a.companyId, Number(q.month.slice(0, 4)));
    const f = ssoForm(t.map((x) => { const e = emps.get(x.employee_id)!; return { employee_id: e.id, code: e.code, title: e.title, first_name: e.first_name, last_name: e.last_name, tax_id: e.tax_id, wage: x.sso_wage, ee: x.sso_ee, er: x.sso_er }; }), law.ssoOn(endOfMonth(q.month)));
    const p = await payer(db, a.companyId, q.branch_id);
    problems(ssoFileProblems(p.sso_employer_no, f.rows.map((r) => ({ tax_id: r.tax_id, title: r.title, first_name: r.first_name, last_name: r.last_name, wage_paid: r.wage_paid, ee: r.ee }))));
    const rows = [['เลขบัตรประชาชน', 'คำนำหน้า', 'ชื่อ', 'สกุล', 'ค่าจ้าง', 'เงินสมทบ'], ...f.rows.map((r) => [{ n: Number(r.tax_id), fmt: 'id13' as const }, r.title ?? '', r.first_name, r.last_name ?? '', { n: Number(r.wage_paid), fmt: '0.00' as const }, { n: Number(r.ee), fmt: '0.00' as const }])];
    await logActivity(db, a, { module: 'PAY', action: 'EXPORT', docNo: `สปส.1-10 ${q.month}`, table: 'pay_run', detail: { file: 'SSO e-Service', rows: f.count } });
    return send(reply, 'application/vnd.ms-excel', ssoFileName(p.sso_employer_no, Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7))), buildXls(p.sso_branch_no.padStart(6, '0'), rows, [16.08, 16.31, 19.92, 18.92, 17.15, 25.46]));
  });

  // ---- ไฟล์โอนเงินเดือน (CSV)
  app.get('/api/v1/pay/runs/:id/bank-file', async (req, reply) => {
    const a = requireCompany(req);
    const run = await loadRun(db, a, parse(z.object({ id: uuid }), req.params).id);
    if (run.status === 'D' || run.status === 'C') throw badRequest('บันทึกรอบเงินเดือนก่อน แล้วจึงทำไฟล์โอน');
    const rows = (await sql<{ code: string; title: string | null; first_name: string; last_name: string | null; bank_code: string | null; bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null; net_pay: string }>`
      SELECT e.code, e.title, e.first_name, e.last_name, b.code AS bank_code, b.name_th AS bank_name, e.bank_account_no, e.bank_account_name, re.net_pay
        FROM pay_run_employee re JOIN pay_employee e ON e.id = re.employee_id LEFT JOIN md_bank b ON b.id = e.bank_id
       WHERE re.run_id = ${run.id} AND re.company_id = ${a.companyId} AND re.deleted_at IS NULL AND e.pay_method = 'B' ORDER BY e.code`.execute(db)).rows;
    const r = bankCsv(rows.map((x) => ({ code: x.code, name: empName(x), bank_code: x.bank_code, bank_name: x.bank_name, account_no: x.bank_account_no, account_name: x.bank_account_name, net: x.net_pay })));
    if (!r.count) throw badRequest('ไม่มีพนักงานที่รับเงินเดือนโดยการโอน (หรือยอดสุทธิเป็นศูนย์)');
    problems(r.problems);
    await logActivity(db, a, { module: 'PAY', action: 'EXPORT', docNo: run.doc_no, table: 'pay_run', rowId: run.id, detail: { file: 'bank transfer', rows: r.count, total: r.total } });
    return send(reply, 'text/csv; charset=utf-8', `โอนเงินเดือน_${run.doc_no}.csv`, Buffer.from(r.text, 'utf8'));
  });

  // ---- นำเข้าพนักงาน
  app.get('/api/v1/pay/employees/import/template', async (_req, reply) => {
    const head = EMP_IMPORT_COLUMNS.map((c) => c.th);
    const text = EMP_IMPORT_COLUMNS.map((c, i) => (['code', 'tax_id', 'birth_date', 'hire_date', 'bank_account_no', 'reg_postcode', 'department', 'branch', 'bank'].includes(c.key) ? i : -1)).filter((i) => i >= 0);
    const help = [['คอลัมน์', 'จำเป็น', 'คำอธิบาย'], ...EMP_IMPORT_COLUMNS.map((c) => [c.th, c.required === 'always' ? 'ต้องมี' : c.required === 'new' ? 'พนักงานใหม่' : '', c.hint]),
      ['', '', ''], ['', '', 'หนึ่งแถว = พนักงานหนึ่งคน · รหัสเดิม = แก้เฉพาะช่องที่กรอก (ช่องว่าง = คงค่าเดิม) · ลบแถวตัวอย่างก่อนใช้ · บันทึกเป็น .xlsx หรือ .csv'],
      ['', '', 'โปรแกรมตรวจทั้งแฟ้มก่อน — มีแถวผิดแม้แถวเดียวจะยังไม่บันทึก แล้วบอกแถวที่ต้องแก้']];
    return send(reply, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'นำเข้าพนักงาน.xlsx',
      buildXlsx([{ name: 'พนักงาน', rows: [head, EMP_IMPORT_COLUMNS.map((c) => c.example)], textCols: text }, { name: 'วิธีกรอก', rows: help, widths: [18, 12, 90] }]));
  });
  app.post('/api/v1/pay/employees/import', async (req) => {
    const a = requireCompany(req);
    const b = parse(uploadBody, req.body);
    const co = await db.selectFrom('sys_company').select('year_system').where('id', '=', a.companyId).executeTakeFirstOrThrow();
    const m = mapEmployeeImport(readTable(b.file_name, Buffer.from(b.data, 'base64')), co.year_system as YearSystem);
    const errors = [...m.errors];
    const look = async (t: 'md_department' | 'md_bank', codes: string[]) => new Map((codes.length ? await db.selectFrom(t).select(['id', 'code']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('code', 'in', codes).execute() : []).map((x) => [x.code.toUpperCase(), x.id]));
    const dept = await look('md_department', [...new Set(m.rows.map((r) => String(r.values.department ?? '')).filter(Boolean))]);
    const bank = await look('md_bank', [...new Set(m.rows.map((r) => String(r.values.bank ?? '')).filter(Boolean))]);
    const branches = new Map((await db.selectFrom('sys_branch').select(['id', 'code']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute()).map((x) => [x.code.toUpperCase(), x.id]));
    const existing = new Map((await db.selectFrom('pay_employee').select(['id', 'code']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute()).map((x) => [x.code.toUpperCase(), x.id]));
    const plan: Array<{ row: number; code: string; id: string | null; body: Record<string, unknown> }> = [];
    for (const r of m.rows) {
      const v = { ...r.values } as Record<string, unknown>;
      const ref = (k: string, map: Map<string, string>, label: string, out: string) => { if (v[k] === undefined) return; const id = map.get(String(v[k]).toUpperCase()); if (!id) errors.push({ row: r.row, message: `ไม่พบ${label}รหัส "${v[k]}"` }); else v[out] = id; delete v[k]; };
      ref('department', dept, 'แผนก', 'department_id'); ref('branch', branches, 'สาขา', 'branch_id'); ref('bank', bank, 'ธนาคาร', 'bank_id');
      const id = existing.get(r.code) ?? null;
      if (!id) for (const c of EMP_IMPORT_COLUMNS.filter((x) => x.required === 'new')) if (v[c.key] === undefined) errors.push({ row: r.row, message: `พนักงานใหม่ ${r.code}: ต้องมี${c.th}` });
      if (id) delete v.rate;
      else v.wage_type ??= 'M';   // ไม่มีคอลัมน์วิธีคิดค่าจ้าง = รายเดือน
      plan.push({ row: r.row, code: r.code, id, body: v });
    }
    if (errors.length || !b.commit) return { ok: !errors.length, committed: false, errors: errors.sort((x, y) => x.row - y.row), rows: plan.map((p) => ({ row: p.row, code: p.code, action: p.id ? 'แก้ไข' : 'เพิ่มใหม่', name: [p.body.title, p.body.first_name, p.body.last_name].filter(Boolean).join(' ') || null })) };
    // บันทึกทั้งแฟ้มในทรานแซกชันเดียว — ผิดคนเดียว = ไม่บันทึกเลย
    return db.transaction().execute(async (tx) => {
      for (const p of plan) {
        let full: Record<string, unknown> = p.body;
        if (p.id) {
          const cur = await loadEmp(tx, a, p.id);
          const keep = Object.fromEntries(Object.entries(cur).filter(([k]) => k in empBody.shape && k !== 'tax_id' && k !== 'bank_account_no'));
          full = { ...keep, hire_date: String(cur.hire_date).slice(0, 10), birth_date: cur.birth_date ? String(cur.birth_date).slice(0, 10) : null, end_date: cur.end_date ? String(cur.end_date).slice(0, 10) : null,
            pvd_join_date: cur.pvd_join_date ? String(cur.pvd_join_date).slice(0, 10) : null, ...p.body };
        }
        const parsed = empBody.safeParse({ ...full, code: p.code });
        if (!parsed.success) throw badRequest(`แถวที่ ${p.row} (${p.code}): ${parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'}`);
        try { await saveEmployee(tx, a, p.id, parsed.data); }
        catch (e) { throw badRequest(`แถวที่ ${p.row} (${p.code}): ${(e as Error).message}`); }
      }
      await logActivity(tx, a, { module: 'PAY', action: 'IMPORT', docNo: b.file_name.slice(0, 60), table: 'pay_employee', detail: { added: plan.filter((p) => !p.id).length, edited: plan.filter((p) => p.id).length } });
      return { ok: true, committed: true, errors: [], added: plan.filter((p) => !p.id).length, edited: plan.filter((p) => p.id).length };
    });
  });

  // ---- นำเข้ายอดประจำงวดเข้ารอบร่าง
  const runImportItems = async (companyId: string) => (await payItems(db, companyId)).filter((i) => i.status === 'A' && i.calc !== 'WAGE' && i.calc !== 'SYSTEM');
  app.get('/api/v1/pay/runs/:id/import/template', async (req, reply) => {
    const a = requireCompany(req);
    const run = await loadRun(db, a, parse(z.object({ id: uuid }), req.params).id);
    const items = await runImportItems(a.companyId);
    const unit = (c: string) => (c === 'HOURS' ? ' (ชั่วโมง)' : c === 'DAYS' ? ' (วัน)' : c === 'MINUTES' ? ' (นาที)' : '');
    const emps = (await sql<{ code: string; title: string | null; first_name: string; last_name: string | null; work_days: string | null; work_hours: string | null }>`SELECT e.code, e.title, e.first_name, e.last_name, re.work_days, re.work_hours
        FROM pay_run_employee re JOIN pay_employee e ON e.id = re.employee_id WHERE re.run_id = ${run.id} AND re.company_id = ${a.companyId} AND re.deleted_at IS NULL ORDER BY e.code`.execute(db)).rows;
    const head = ['รหัสพนักงาน', 'ชื่อ', 'วันทำงาน', 'ชั่วโมงทำงาน', ...items.map((i) => `${i.code} ${i.name_th}${unit(i.calc)}`)];
    const rows = emps.map((e) => [e.code, empName(e), e.work_days ? d(e.work_days).toString() : '', e.work_hours ? d(e.work_hours).toString() : '', ...items.map(() => '')]);
    return send(reply, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `ยอดงวด_${run.period_from.slice(0, 7)}.xlsx`,
      buildXlsx([{ name: 'ยอดงวด', rows: [head, ...rows], textCols: [0], widths: [14, 26, 10, 12, ...items.map(() => 18)] },
        { name: 'วิธีกรอก', header: false, rows: [['ใส่จำนวนชั่วโมง/วัน/นาที ในคอลัมน์ที่มีหน่วย · ใส่จำนวนเงินในคอลัมน์อื่น · ช่องว่าง/ศูนย์ = ไม่มี'], ['แถวที่กรอกจะแทนรายการที่ป้อนเองเดิมของพนักงานคนนั้นทั้งหมด (รายการประจำและเงินเดือนคิดให้เอง)'], ['วันทำงาน/ชั่วโมงทำงาน ใช้กับพนักงานรายวัน/รายชั่วโมง']], widths: [100] }]));
  });
  app.post('/api/v1/pay/runs/:id/import', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(uploadBody, req.body);
    mustDraft(await loadRun(db, a, id));
    const items = await runImportItems(a.companyId);
    const m = mapRunImport(readTable(b.file_name, Buffer.from(b.data, 'base64')), items.map((i) => ({ code: i.code, calc: i.calc })));
    const errors = [...m.errors];
    const res = new Map((await sql<{ id: string; code: string }>`SELECT re.id, e.code FROM pay_run_employee re JOIN pay_employee e ON e.id = re.employee_id WHERE re.run_id = ${id} AND re.company_id = ${a.companyId} AND re.deleted_at IS NULL`.execute(db)).rows.map((x) => [x.code.toUpperCase(), x.id]));
    for (const r of m.rows) if (!res.has(r.code)) errors.push({ row: r.row, message: `พนักงาน ${r.code} ไม่อยู่ในรอบนี้ — เพิ่มพนักงานในรอบก่อน` });
    const filled = m.rows.filter((r) => r.lines.length || r.work_days !== null || r.work_hours !== null);
    if (errors.length || !b.commit) return { ok: !errors.length, committed: false, errors: errors.sort((x, y) => x.row - y.row), rows: filled.map((r) => ({ row: r.row, code: r.code, lines: r.lines.length, work_days: r.work_days, work_hours: r.work_hours })) };
    return db.transaction().execute(async (tx) => {
      const run = await loadRun(tx, a, id, true);
      mustDraft(run);
      const byCode = new Map(items.map((i) => [i.code.toUpperCase(), i]));
      const c = await calcCtx(tx, a, run);
      for (const r of filled) {
        const reId = res.get(r.code)!;
        if (r.work_days !== null || r.work_hours !== null) await tx.updateTable('pay_run_employee').set({ ...(r.work_days !== null ? { work_days: r.work_days } : {}), ...(r.work_hours !== null ? { work_hours: r.work_hours } : {}), updated_by: a.userId }).where('id', '=', reId).execute();
        if (r.lines.length) {
          await tx.updateTable('pay_run_line').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('run_employee_id', '=', reId).where('source', 'in', ['MANUAL', 'IMPORT']).where('deleted_at', 'is', null).execute();
          for (const [k, l] of r.lines.entries()) await tx.insertInto('pay_run_line').values({ company_id: a.companyId, run_id: id, run_employee_id: reId, item_id: byCode.get(l.item_code.toUpperCase())!.id, qty: l.qty, amount: l.amount ? round2(l.amount).toFixed(2) : '0', source: 'IMPORT', sort_order: 100 + k, created_by: a.userId }).execute();
        }
        await calcEmployee(tx, a, run, reId, c);
      }
      await totals(tx, a, id);
      await logActivity(tx, a, { module: 'PAY', action: 'IMPORT', docNo: run.doc_no ?? `ร่าง ${run.period_from.slice(0, 7)}`, table: 'pay_run', rowId: id, detail: { file: b.file_name.slice(0, 60), employees: filled.length } });
      return { ok: true, committed: true, errors: [], employees: filled.length };
    });
  });

  // ---- บันทึกการยื่น/นำส่ง
  app.get('/api/v1/pay/filings', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ year: yearQ }), req.query);
    const rows = await db.selectFrom('pay_filing as f').leftJoin('gl_journal as j', 'j.id', 'f.journal_id').leftJoin('sys_branch as b', 'b.id', 'f.branch_id')
      .select(['f.id', 'f.form', 'f.period', 'f.filing_no', 'f.headcount', 'f.base_amount', 'f.amount', 'f.surcharge', 'f.filed_date', 'f.receipt_no', 'f.status', 'f.note', 'f.cancel_reason', 'f.journal_id', 'j.voucher_no', 'b.code as branch_code'])
      .where('f.company_id', '=', a.companyId).where('f.deleted_at', 'is', null).where('f.period', '>=', `${q.year}-01-01`).where('f.period', '<=', `${q.year}-12-01`).orderBy('f.period', 'desc').orderBy('f.form').orderBy('f.filing_no').execute();
    return rows.map((r) => ({ ...r, period: String(r.period).slice(0, 10), filed_date: String(r.filed_date).slice(0, 10) }));
  });
  /** ยอดที่ต้องนำส่งตามรอบเงินเดือนที่บันทึกแล้ว (ค่าเริ่มต้นของหน้าบันทึกการยื่น) */
  const due = async (companyId: string, form: string, period: string, branchId?: string) => {
    if (form === 'PND1A') { const r = await rdRows(db, companyId, { year: Number(period.slice(0, 4)), branch_id: branchId }); return { headcount: r.count, base: r.income, amount: '0.00' }; }
    const t = (await totalsBy(db, companyId, period, period, branchId));
    if (form === 'PND1') { const r = pnd1Rows(t.map((x) => ({ employee_id: x.employee_id, code: x.employee_id, title: null, first_name: '', last_name: null, tax_id: null, bearer: 'W' as TaxBearer, pay_date: period, totals: x }))); return { headcount: r.count, base: r.income, amount: r.tax }; }
    if (form === 'SSO') { const u = t.filter((x) => d(x.sso_ee).gt(0)); return { headcount: u.length, base: u.reduce((s, x) => s.plus(x.sso_wage), d(0)).toFixed(2), amount: u.reduce((s, x) => s.plus(d(x.sso_ee)).plus(d(x.sso_er)), d(0)).toFixed(2) }; }
    const u = t.filter((x) => d(x.pvd_ee).gt(0) || d(x.pvd_er).gt(0));
    const pvd = (await sql<{ ee: string; er: string }>`SELECT coalesce(sum(re.pvd_ee),0) AS ee, coalesce(sum(re.pvd_er),0) AS er FROM pay_run_employee re JOIN pay_run r ON r.id = re.run_id
        WHERE re.company_id = ${companyId} AND re.deleted_at IS NULL AND r.deleted_at IS NULL AND r.status IN ('N','P') AND r.tax_month = ${period} ${branchId ? sql`AND r.branch_id = ${branchId}` : sql``}`.execute(db)).rows[0]!;
    return { headcount: u.length, base: '0.00', amount: d(pvd.ee).plus(pvd.er).toFixed(2) };
  };
  const FORMS = { PND1: { role: 'PAY_WHT1_PAYABLE', label: 'นำส่งภาษีหัก ณ ที่จ่าย ภ.ง.ด.1' }, SSO: { role: 'PAY_SSO_PAYABLE', label: 'นำส่งเงินสมทบประกันสังคม' }, PVD: { role: 'PAY_PVD_PAYABLE', label: 'นำส่งเงินกองทุนสำรองเลี้ยงชีพ' }, PND1A: { role: null, label: 'ยื่น ภ.ง.ด.1ก' } } as const;
  app.get('/api/v1/pay/filings/due', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ form: z.enum(['PND1', 'PND1A', 'SSO', 'PVD']), period: z.string().regex(/^\d{4}(-\d{2})?$/), branch_id: optUuid }), req.query);
    const period = q.form === 'PND1A' ? `${q.period.slice(0, 4)}-01-01` : `${q.period.slice(0, 7)}-01`;
    return { ...(await due(a.companyId, q.form, period, q.branch_id)), drafts: await draftCount(db, a.companyId, period, q.form === 'PND1A' ? `${period.slice(0, 4)}-12-01` : period, q.branch_id) };
  });
  const filingBody = z.object({
    form: z.enum(['PND1', 'PND1A', 'SSO', 'PVD']), period: z.string().regex(/^\d{4}(-\d{2})?$/, 'เลือกเดือน/ปี'), branch_id: uuid.nullable().optional(), filing_no: z.number().int().min(0).max(9).default(0),
    filed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ป้อนวันที่ยื่น'), receipt_no: z.string().trim().max(60).nullable().optional(), amount: z.union([z.string(), z.number()]).nullable().optional(),
    surcharge: z.union([z.string(), z.number()]).default('0'), pay_account_id: uuid.nullable().optional(), surcharge_account_id: uuid.nullable().optional(), note: z.string().trim().max(200).nullable().optional(),
  });
  app.post('/api/v1/pay/filings', async (req) => {
    const a = requireCompany(req);
    const b = parse(filingBody, req.body);
    const period = b.form === 'PND1A' ? `${b.period.slice(0, 4)}-01-01` : `${b.period.slice(0, 7)}-01`;
    if (b.branch_id && !(await db.selectFrom('sys_branch').select('id').where('id', '=', b.branch_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบสาขานี้');
    const due0 = await due(a.companyId, b.form, period, b.branch_id ?? undefined);
    const amount = b.amount === null || b.amount === undefined || b.amount === '' ? d(due0.amount) : d(String(b.amount).replace(/,/g, ''));
    const surcharge = d(String(b.surcharge || 0).replace(/,/g, ''));
    if (amount.lt(0) || surcharge.lt(0)) throw badRequest('จำนวนเงินต้องไม่ติดลบ');
    const F = FORMS[b.form];
    const pay = !!F.role && amount.plus(surcharge).gt(0);
    if (pay && !b.pay_account_id) throw badRequest('เลือกบัญชีที่จ่ายเงิน (เงินสด/เงินฝาก)', [{ field: 'pay_account_id', message: 'เลือกบัญชี' }]);
    if (pay) await checkAccount(db, a.companyId, b.pay_account_id, 'pay_account_id');
    if (surcharge.gt(0)) { if (!b.surcharge_account_id) throw badRequest('เลือกบัญชีค่าใช้จ่ายสำหรับเงินเพิ่ม/ค่าปรับ', [{ field: 'surcharge_account_id', message: 'เลือกบัญชี' }]); await checkAccount(db, a.companyId, b.surcharge_account_id, 'surcharge_account_id'); }
    return db.transaction().execute(async (tx) => {
      let dupQ = tx.selectFrom('pay_filing').select('id').where('company_id', '=', a.companyId).where('form', '=', b.form).where('period', '=', period).where('filing_no', '=', b.filing_no).where('status', '=', 'A').where('deleted_at', 'is', null);
      dupQ = b.branch_id ? dupQ.where('branch_id', '=', b.branch_id) : dupQ.where('branch_id', 'is', null);
      if (await dupQ.executeTakeFirst()) throw conflict(`บันทึกการยื่น${b.filing_no ? `เพิ่มเติมครั้งที่ ${b.filing_no}` : 'ปกติ'}ของงวดนี้ไว้แล้ว — ยกเลิกรายการเดิมก่อน หรือเลือกยื่นเพิ่มเติม`);
      let jid: string | null = null;
      if (pay) {
        const acc = (await tx.selectFrom('gl_default_account').select('account_id').where('company_id', '=', a.companyId).where('role', '=', F.role!).where('deleted_at', 'is', null).executeTakeFirst())?.account_id;
        if (!acc && amount.gt(0)) throw badRequest(`ยังไม่ได้กำหนดบัญชี ${F.label.replace('นำส่ง', '')}ค้างจ่าย — กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี (หมวด "เงินเดือน")`);
        await periodFor(tx, a.companyId, b.filed_date);
        const no = await nextPayNo(tx, a.companyId, 'PF', b.filed_date);
        const ym = period.slice(0, 7);
        const lines = [
          ...(amount.gt(0) ? [{ account_id: acc!, department_id: null, debit: amount.toFixed(2), credit: '0.00', role: F.role! }] : []),
          ...(surcharge.gt(0) ? [{ account_id: b.surcharge_account_id!, department_id: null, debit: surcharge.toFixed(2), credit: '0.00' }] : []),
          { account_id: b.pay_account_id!, department_id: null, debit: '0.00', credit: amount.plus(surcharge).toFixed(2) },
        ];
        jid = await writeJournal(tx, a, null, { book: await bookFor(tx, a.companyId, 'PAYROLL_PAY'), no, date: b.filed_date, desc: `${F.label} ${b.form === 'PND1A' ? ym.slice(0, 4) : ym}${b.filing_no ? ` (เพิ่มเติม ${b.filing_no})` : ''}`, branch: b.branch_id ?? null }, lines);
      }
      const r = await tx.insertInto('pay_filing').values({ company_id: a.companyId, form: b.form, period, filing_no: b.filing_no, branch_id: b.branch_id ?? null, headcount: due0.headcount, base_amount: d(due0.base).toFixed(2),
        amount: amount.toFixed(2), surcharge: surcharge.toFixed(2), filed_date: b.filed_date, receipt_no: b.receipt_no ?? null, pay_account_id: pay ? b.pay_account_id! : null, surcharge_account_id: surcharge.gt(0) ? b.surcharge_account_id! : null,
        journal_id: jid, status: 'A', note: b.note ?? null, created_by: a.userId, updated_by: a.userId }).returning('id').executeTakeFirstOrThrow();
      await logActivity(tx, a, { module: 'PAY', action: 'FILE', docNo: `${b.form} ${period.slice(0, 7)}`, table: 'pay_filing', rowId: r.id, detail: { amount: amount.toFixed(2), surcharge: surcharge.toFixed(2), filing_no: b.filing_no } });
      return { id: r.id, journal_id: jid };
    });
  });
  app.post('/api/v1/pay/filings/:id/cancel', async (req) => {
    const a = requireCompany(req);
    const id = parse(z.object({ id: uuid }), req.params).id;
    const b = parse(z.object({ reason: z.string().trim().min(1, 'ป้อนเหตุผล').max(200) }), req.body);
    return db.transaction().execute(async (tx) => {
      const f = await tx.selectFrom('pay_filing').select(['form', 'period', 'status', 'journal_id']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!f) throw notFound('การยื่นแบบ');
      if (f.status === 'C') throw badRequest('รายการนี้ถูกยกเลิกแล้ว');
      await voidJournal(tx, a, f.journal_id, `ยกเลิกการยื่น/นำส่ง: ${b.reason}`);
      await tx.updateTable('pay_filing').set({ status: 'C', cancel_reason: b.reason, updated_by: a.userId }).where('id', '=', id).execute();
      await logActivity(tx, a, { module: 'PAY', action: 'CANCEL', docNo: `${f.form} ${String(f.period).slice(0, 7)}`, table: 'pay_filing', rowId: id, detail: { reason: b.reason } });
      return { ok: true };
    });
  });
}
