import { sql } from 'kysely';
import { d, type Decimal, type ReportColumn, type ReportRow } from '@buddy/core';
import { badRequest } from '../../http.js';
import { closingOf, fiscalYearOf, isPL, leafTotals, loadChart, type Totals } from '../gl/balances.js';
import { defineReport, type P } from './index.js';

/**
 * รายงานบัญชี (กลุ่ม 5) — ผังบัญชี · สรุปยอดเคลื่อนไหว · รายการงบประมาณ · กระดาษทำการ · ตรวจสอบข้อมูล 5.A (คู่มือบทที่ 21 S-CK-04) · เงินสดย่อย
 * ยอดคำนวณสดจากใบสำคัญ (leafTotals) — ตรงกับงบทดลองเสมอ
 */
const money = (x: Decimal) => x.toFixed(2);
const GROUP = ['', 'สินทรัพย์', 'หนี้สิน', 'ทุน', 'รายได้', 'ค่าใช้จ่าย'];
const ymd = (p: P, fallback: string) => p.dates('date').map((x, i) => x ?? (i ? new Date().toISOString().slice(0, 10) : fallback)) as [string, string];

export function glReports() {
  // 5.1 ผังบัญชี
  defineReport('5.1', async (db, a, p) => {
    const chart = await loadChart(db, a.companyId);
    const f = p.str('account_from'), t = p.str('account_to');
    const rows: ReportRow[] = [...chart.byId.values()].filter((x) => (!f || x.account_no >= f) && (!t || x.account_no <= t)).sort((x, y) => x.account_no.localeCompare(y.account_no))
      .map((x) => ({ t: x.is_control ? 'group' as const : undefined, c: { no: x.account_no, name: `${'  '.repeat(Math.max(0, x.level - 1))}${x.name_th}`, en: x.name_en, grp: GROUP[Number(x.account_group)] ?? x.account_group,
        kind: x.is_control ? 'คุม' : 'ย่อย', side: x.normal_side === 'C' ? 'เครดิต' : 'เดบิต', dept: x.use_department ? 'ระบุแผนก' : '', status: x.status === 'A' ? '' : 'เลิกใช้' }, muted: x.status !== 'A' }));
    rows.push({ t: 'total', c: { name: `รวม ${rows.length} บัญชี` } });
    return { subtitle: p.describe({ account: 'เลขที่บัญชี' }) || 'ทั้งหมด', rows, columns: [{ key: 'no', label: 'เลขที่บัญชี', kind: 'mono', width: 110 }, { key: 'name', label: 'ชื่อบัญชี' }, { key: 'en', label: 'ชื่ออังกฤษ' },
      { key: 'grp', label: 'หมวด', width: 80 }, { key: 'kind', label: 'ชนิด', width: 50 }, { key: 'side', label: 'ยอดปกติ', width: 60 }, { key: 'dept', label: 'แผนก', width: 70 }, { key: 'status', label: 'สถานะ', width: 60 }] as ReportColumn[] };
  });

  // 5.3 สรุปยอดเคลื่อนไหว (ยกมา เดบิต เครดิต คงเหลือ รายบัญชีย่อย ช่วงวันที่ + แผนก)
  defineReport('5.3', async (db, a, p) => {
    const fy = await fiscalYearOf(db, a.companyId, p.date('date_to') ?? new Date().toISOString().slice(0, 10));
    const [from, to] = ymd(p, fy ? String(fy.start_date).slice(0, 10) : '1900-01-01');
    const chart = await loadChart(db, a.companyId);
    const dw = p.str('dept');
    const depts = dw && dw !== '*' ? (await sql<{ id: string }>`SELECT id FROM md_department WHERE company_id = ${a.companyId} AND deleted_at IS NULL ${p.dept(sql`code`)}`.execute(db)).rows.map((x) => x.id) : null;
    const leaf = await leafTotals(db, a.companyId, chart, from, to, depts ? { departmentIds: depts } : {});
    const f = p.str('account_from'), t = p.str('account_to');
    const rows: ReportRow[] = [];
    const tot: Totals = { opening: d(0), debit: d(0), credit: d(0) };
    for (const acc of [...chart.byId.values()].filter((x) => !x.is_control && (!f || x.account_no >= f) && (!t || x.account_no <= t)).sort((x, y) => x.account_no.localeCompare(y.account_no))) {
      const v = leaf.get(acc.id);
      if (!v || (!p.bool('zero') && v.opening.isZero() && v.debit.isZero() && v.credit.isZero())) continue;
      tot.opening = tot.opening.plus(v.opening); tot.debit = tot.debit.plus(v.debit); tot.credit = tot.credit.plus(v.credit);
      rows.push({ c: { no: acc.account_no, name: acc.name_th, open: money(v.opening), debit: money(v.debit), credit: money(v.credit), close: money(closingOf(v)) }, link: `/reports/ledger?account_id=${acc.id}&from=${from}&to=${to}` });
    }
    rows.push({ t: 'total', c: { name: `รวม ${rows.length} บัญชี`, open: money(tot.opening), debit: money(tot.debit), credit: money(tot.credit), close: money(closingOf(tot)) } });
    return { subtitle: `วันที่ ${p.fd(from)} – ${p.fd(to)}${depts ? ` · แผนก ${dw}` : ''}`, rows, columns: [{ key: 'no', label: 'เลขที่บัญชี', kind: 'mono', width: 110 }, { key: 'name', label: 'ชื่อบัญชี' },
      { key: 'open', label: 'ยอดยกมา (Dr+/Cr−)', kind: 'money', width: 140 }, { key: 'debit', label: 'เดบิต', kind: 'money', width: 140 }, { key: 'credit', label: 'เครดิต', kind: 'money', width: 140 }, { key: 'close', label: 'คงเหลือ (Dr+/Cr−)', kind: 'money', width: 140 }] as ReportColumn[] };
  });

  // 5.7 รายการงบประมาณ: งบประมาณเทียบยอดจริงของงวด (+ สะสมตั้งแต่ต้นปี)
  defineReport('5.7', async (db, a, p) => {
    const per = p.str('period') ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) throw badRequest('งวดไม่ถูกต้อง — เลือกเดือน');
    const pr = await db.selectFrom('gl_period').select(['id', 'fiscal_year_id', 'period_no', 'start_date', 'end_date']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null)
      .where('start_date', '<=', `${per}-28`).where('end_date', '>=', `${per}-01`).orderBy('start_date').executeTakeFirst();
    if (!pr) throw badRequest('ไม่พบงวดบัญชีของเดือนที่เลือก');
    const fy = await db.selectFrom('gl_fiscal_year').select('start_date').where('id', '=', pr.fiscal_year_id).executeTakeFirstOrThrow();
    const chart = await loadChart(db, a.companyId);
    const s = String(pr.start_date).slice(0, 10), e = String(pr.end_date).slice(0, 10), ys = String(fy.start_date).slice(0, 10);
    const [mv, ytd] = await Promise.all([leafTotals(db, a.companyId, chart, s, e), leafTotals(db, a.companyId, chart, ys, e)]);
    const bud = (await sql<{ account_id: string; per: string; ytd: string }>`SELECT b.account_id, sum(b.amount) FILTER (WHERE b.period_id = ${pr.id}) AS per, sum(b.amount) AS ytd
        FROM gl_budget b JOIN gl_period gp ON gp.id = b.period_id WHERE b.company_id = ${a.companyId} AND b.deleted_at IS NULL AND gp.fiscal_year_id = ${pr.fiscal_year_id} AND gp.period_no <= ${pr.period_no}
         ${p.dept(sql`(SELECT code FROM md_department WHERE id = b.department_id)`)} GROUP BY b.account_id`.execute(db)).rows;
    const rows: ReportRow[] = [];
    const f = p.str('account_from'), t = p.str('account_to');
    for (const b of bud) {
      const acc = chart.byId.get(b.account_id);
      if (!acc || (f && acc.account_no < f) || (t && acc.account_no > t)) continue;
      const act = (m: Map<string, Totals>) => { const x = m.get(acc.id); return x ? chart.natural(acc.id, x.debit.minus(x.credit)) : d(0); };
      const ap = act(mv), ay = act(ytd);
      rows.push({ c: { no: acc.account_no, name: acc.name_th, bud: b.per ?? '0', act: money(ap), diff: money(ap.minus(d(b.per ?? 0))), budy: b.ytd, acty: money(ay), diffy: money(ay.minus(d(b.ytd))) } });
    }
    rows.sort((x, y) => String(x.c.no).localeCompare(String(y.c.no)));
    rows.push({ t: 'total', c: { name: `รวม ${rows.length} บัญชี` } });
    return { subtitle: `งวดที่ ${pr.period_no} (${p.fd(s)} – ${p.fd(e)})`, rows, columns: [{ key: 'no', label: 'เลขที่บัญชี', kind: 'mono', width: 100 }, { key: 'name', label: 'ชื่อบัญชี' },
      { key: 'bud', label: 'งบประมาณงวดนี้', kind: 'money', width: 120 }, { key: 'act', label: 'ยอดจริงงวดนี้', kind: 'money', width: 120 }, { key: 'diff', label: 'ผลต่าง', kind: 'money', width: 110 },
      { key: 'budy', label: 'งบประมาณสะสม', kind: 'money', width: 120 }, { key: 'acty', label: 'ยอดจริงสะสม', kind: 'money', width: 120 }, { key: 'diffy', label: 'ผลต่างสะสม', kind: 'money', width: 110 }] as ReportColumn[] };
  });

  // 5.8 กระดาษทำการ: งบทดลอง → งบกำไรขาดทุน / งบดุล (บัญชีย่อยที่มียอด)
  defineReport('5.8', async (db, a, p) => {
    const fy = await fiscalYearOf(db, a.companyId, p.date('date_to') ?? new Date().toISOString().slice(0, 10));
    if (!fy) throw badRequest('วันที่สิ้นงวดไม่อยู่ในรอบบัญชี');
    const from = String(fy.start_date).slice(0, 10), to = p.date('date_to') ?? new Date().toISOString().slice(0, 10);
    const chart = await loadChart(db, a.companyId);
    const leaf = await leafTotals(db, a.companyId, chart, from, to);
    const rows: ReportRow[] = [];
    const T = { tbd: d(0), tbc: d(0), pld: d(0), plc: d(0), bsd: d(0), bsc: d(0) };
    for (const acc of [...chart.byId.values()].filter((x) => !x.is_control).sort((x, y) => x.account_no.localeCompare(y.account_no))) {
      const v = leaf.get(acc.id);
      if (!v) continue;
      const c = closingOf(v);
      if (c.isZero()) continue;
      const dr = c.gt(0) ? c : d(0), cr = c.lt(0) ? c.neg() : d(0);
      const pl = isPL(acc.account_group);
      T.tbd = T.tbd.plus(dr); T.tbc = T.tbc.plus(cr);
      if (pl) { T.pld = T.pld.plus(dr); T.plc = T.plc.plus(cr); } else { T.bsd = T.bsd.plus(dr); T.bsc = T.bsc.plus(cr); }
      rows.push({ c: { no: acc.account_no, name: acc.name_th, tbd: money(dr), tbc: money(cr), ...(pl ? { pld: money(dr), plc: money(cr) } : { bsd: money(dr), bsc: money(cr) }) } });
    }
    const profit = T.plc.minus(T.pld);
    rows.push({ t: 'sub', c: { name: 'รวม', tbd: money(T.tbd), tbc: money(T.tbc), pld: money(T.pld), plc: money(T.plc), bsd: money(T.bsd), bsc: money(T.bsc) } });
    rows.push({ t: 'sub', c: { name: profit.gte(0) ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ', ...(profit.gte(0) ? { pld: money(profit), bsc: money(profit) } : { plc: money(profit.neg()), bsd: money(profit.neg()) }) } });
    rows.push({ t: 'total', c: { name: 'รวมทั้งสิ้น', pld: money(T.pld.plus(profit.gte(0) ? profit : d(0))), plc: money(T.plc.plus(profit.lt(0) ? profit.neg() : d(0))),
      bsd: money(T.bsd.plus(profit.lt(0) ? profit.neg() : d(0))), bsc: money(T.bsc.plus(profit.gte(0) ? profit : d(0))) } });
    return { subtitle: `ตั้งแต่ ${p.fd(from)} ถึง ${p.fd(to)}`, rows, columns: [{ key: 'no', label: 'เลขที่บัญชี', kind: 'mono', width: 100 }, { key: 'name', label: 'ชื่อบัญชี' },
      { key: 'tbd', label: 'งบทดลอง Dr', kind: 'money', width: 120 }, { key: 'tbc', label: 'งบทดลอง Cr', kind: 'money', width: 120 }, { key: 'pld', label: 'กำไรขาดทุน Dr', kind: 'money', width: 120 },
      { key: 'plc', label: 'กำไรขาดทุน Cr', kind: 'money', width: 120 }, { key: 'bsd', label: 'งบดุล Dr', kind: 'money', width: 120 }, { key: 'bsc', label: 'งบดุล Cr', kind: 'money', width: 120 }] as ReportColumn[] };
  });

  // 5.A.1 รายการที่เลขบัญชีไม่ถูกต้อง: ลงบัญชีคุม / บัญชีเลิกใช้ / ต้องระบุแผนกแต่ไม่มี
  defineReport('5.A.1', async (db, a) => {
    const rows = (await sql<{ kind: string; voucher_no: string; voucher_date: string; journal_id: string; account_no: string; name_th: string; amount: string }>`
      SELECT CASE WHEN g.is_control THEN 'ลงบัญชีคุม' WHEN g.status <> 'A' THEN 'บัญชีเลิกใช้' ELSE 'ไม่ระบุแผนก' END AS kind, j.voucher_no, j.voucher_date, j.id AS journal_id, g.account_no, g.name_th, (l.debit - l.credit)::text AS amount
        FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id JOIN gl_account g ON g.id = l.account_id
       WHERE j.company_id = ${a.companyId} AND j.doc_status <> 'C' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND (g.is_control OR g.status <> 'A' OR (g.use_department AND l.department_id IS NULL))
       ORDER BY 1, j.voucher_date, j.voucher_no LIMIT 10000`.execute(db)).rows;
    const out: ReportRow[] = []; let k: string | null = null;
    for (const r of rows) { if (r.kind !== k) { k = r.kind; out.push({ t: 'group', c: { no: r.kind } }); } out.push({ c: { no: r.voucher_no, date: r.voucher_date, acc: `${r.account_no} ${r.name_th}`, amount: r.amount }, link: `/gl/journals/${r.journal_id}` }); }
    out.push({ t: 'total', c: { acc: rows.length ? `พบ ${rows.length} รายการ` : 'ไม่พบรายการที่เลขบัญชีไม่ถูกต้อง' } });
    return { subtitle: 'ทุกใบสำคัญที่ยังไม่ยกเลิก', rows: out, columns: [{ key: 'no', label: 'เลขที่ใบสำคัญ', kind: 'mono', width: 140 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'acc', label: 'บัญชี' }, { key: 'amount', label: 'จำนวนเงิน (Dr+/Cr−)', kind: 'money', width: 140 }] as ReportColumn[] };
  });

  // 5.A.2 ใบสำคัญที่ยอดไม่ได้ดุลย์ (คำนวณจากบรรทัดจริง)
  defineReport('5.A.2', async (db, a, p) => {
    const rows = (await sql<{ id: string; voucher_no: string; voucher_date: string; description: string | null; dr: string; cr: string }>`SELECT j.id, j.voucher_no, j.voucher_date, j.description, sum(l.debit) AS dr, sum(l.credit) AS cr
        FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL WHERE j.company_id = ${a.companyId} AND j.doc_status <> 'C' AND j.deleted_at IS NULL ${p.dateRange('date', sql`j.voucher_date`)}
       GROUP BY j.id HAVING abs(sum(l.debit) - sum(l.credit)) >= 0.005 ORDER BY j.voucher_date, j.voucher_no LIMIT 5000`.execute(db)).rows;
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows: [...rows.map((r) => ({ c: { no: r.voucher_no, date: r.voucher_date, desc: r.description, dr: r.dr, cr: r.cr, diff: money(d(r.dr).minus(d(r.cr))) }, link: `/gl/journals/${r.id}` })),
      { t: 'total' as const, c: { desc: rows.length ? `พบ ${rows.length} ใบ` : 'ทุกใบสำคัญดุล' } }],
      columns: [{ key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'desc', label: 'คำอธิบาย' }, { key: 'dr', label: 'เดบิต', kind: 'money', width: 130 },
        { key: 'cr', label: 'เครดิต', kind: 'money', width: 130 }, { key: 'diff', label: 'ผลต่าง', kind: 'money', width: 110 }] as ReportColumn[] };
  });

  // 5.A.3 รายงานการแก้ไขปรับปรุงรายการ (จากบันทึกการทำงาน — แก้/ยกเลิก/ลบ)
  defineReport('5.A.3', async (db, a, p) => {
    const [f, t] = p.dates('date');
    const rows = (await sql<{ occurred_at: string; user_name: string | null; module: string | null; action: string; doc_no: string | null; detail: unknown }>`SELECT l.occurred_at, u.display_name AS user_name, l.module, l.action, l.doc_no, l.detail
        FROM sys_activity_log l LEFT JOIN sys_user u ON u.id = l.user_id
       WHERE l.company_id = ${a.companyId} AND l.action IN ('EDIT', 'CANCEL', 'DELETE') ${f ? sql`AND l.occurred_at >= ${f}::date` : sql``} ${t ? sql`AND l.occurred_at < (${t}::date + 1)` : sql``}
       ORDER BY l.occurred_at DESC LIMIT 10000`.execute(db)).rows;
    const ACT: Record<string, string> = { EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', DELETE: 'ลบ' };
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows: [...rows.map((r) => ({ c: { at: new Date(r.occurred_at).toISOString().slice(0, 16).replace('T', ' '), user: r.user_name, module: r.module, action: ACT[r.action] ?? r.action, doc: r.doc_no,
      detail: r.detail ? JSON.stringify(r.detail).slice(0, 200) : '' } })), { t: 'total' as const, c: { user: `รวม ${rows.length} รายการ` } }],
      columns: [{ key: 'at', label: 'เวลา (UTC)', kind: 'mono', width: 140 }, { key: 'user', label: 'ผู้ใช้', width: 140 }, { key: 'module', label: 'ระบบ', width: 80 }, { key: 'action', label: 'การทำงาน', width: 80 },
        { key: 'doc', label: 'เอกสาร', kind: 'mono', width: 140 }, { key: 'detail', label: 'รายละเอียด' }] as ReportColumn[] };
  });

  // 5.C เงินสดย่อย: ใบจ่าย DP + การเบิกชดเชย VR
  defineReport('5.C', async (db, a, p) => {
    const hs = (await sql<{ id: string; doc_class: string; doc_no: string; doc_date: string; remark: string | null; net_amount: string; vr_no: string | null }>`
      SELECT h.id, h.doc_class, h.doc_no, h.doc_date, h.remark, h.net_amount,
        coalesce((SELECT v.doc_no FROM doc_link k JOIN doc_header v ON v.id = k.to_header_id AND v.doc_status <> 'C' WHERE k.from_header_id = h.id AND k.link_type = 'REIMBURSE' AND k.deleted_at IS NULL LIMIT 1),
          CASE WHEN h.doc_class = 'DP' THEN h.ref_no END) AS vr_no   -- ข้อมูลย้ายจาก Express: เลขที่ใบเบิกชดเชยอยู่ใน ref_no
        FROM doc_header h WHERE h.company_id = ${a.companyId} AND h.doc_class IN ('DP', 'VR') AND h.doc_status <> 'C' AND h.deleted_at IS NULL ${p.dateRange('date', sql`h.doc_date`)}
       ORDER BY h.doc_class, h.doc_date, h.doc_no LIMIT 10000`.execute(db)).rows;
    const ls = hs.length && p.bool('detail') ? (await sql<{ header_id: string; account_no: string | null; description: string | null; net_amount: string }>`SELECT l.header_id, g.account_no, l.description, l.net_amount FROM doc_line l LEFT JOIN gl_account g ON g.id = l.account_id
        WHERE l.header_id IN (${sql.join(hs.map((h) => h.id))}) AND l.deleted_at IS NULL ORDER BY l.header_id, l.line_no`.execute(db)).rows : [];
    const rows: ReportRow[] = []; let k: string | null = null, dp = d(0), vr = d(0), open = d(0);
    for (const h of hs) {
      if (h.doc_class !== k) { k = h.doc_class; rows.push({ t: 'group', c: { no: k, desc: k === 'DP' ? 'ใบสำคัญจ่ายเงินสดย่อย' : 'เบิกชดเชยเงินสดย่อย' } }); }
      if (h.doc_class === 'DP') { dp = dp.plus(d(h.net_amount)); if (!h.vr_no) open = open.plus(d(h.net_amount)); } else vr = vr.plus(d(h.net_amount));
      rows.push({ c: { no: h.doc_no, date: h.doc_date, desc: h.remark, vr: h.doc_class === 'DP' ? h.vr_no ?? 'ยังไม่เบิก' : '', amount: h.net_amount }, link: `/fi/petty-cash/${h.doc_class.toLowerCase()}/${h.id}` });
      for (const l of ls.filter((x) => x.header_id === h.id)) rows.push({ t: 'detail', c: { desc: `${l.account_no ?? ''} ${l.description ?? ''}`, amount: l.net_amount } });
    }
    rows.push({ t: 'total', c: { desc: `จ่าย ${money(dp)} · เบิกชดเชย ${money(vr)} · ยังไม่เบิก ${money(open)}` } });
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows, columns: [{ key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'desc', label: 'รายการ' },
      { key: 'vr', label: 'เบิกชดเชยใน', kind: 'mono', width: 130 }, { key: 'amount', label: 'จำนวนเงิน', kind: 'money', width: 130 }] as ReportColumn[] };
  });
}
