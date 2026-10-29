import { sql, type RawBuilder } from 'kysely';
import { d, type Decimal, type ReportColumn, type ReportRow, TRADE_KINDS, SETTLE_KINDS } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest } from '../../http.js';
import { defineReport, type Ctx, type P } from './index.js';

/**
 * รายงานลูกหนี้/เจ้าหนี้ (กลุ่ม 1.A–1.H, 1.4.A · 2.A–2.G, 2.4.6) — ยอดคงค้าง ณ วันที่ คำนวณสดจากเอกสาร + รายการตัดหนี้ที่ลงวันที่ไม่เกินวันนั้น
 * ลูกหนี้: IV DR (+) CN (−) · เจ้าหนี้: RR CP (+) DN (−) · รายการตัดหนี้นับวันที่ของใบเสร็จ/ใบจ่าย (ข้อมูลย้ายจาก Express ที่ตัดด้วยใบสำคัญ ใช้วันที่ใบสำคัญ)
 */
type Side = { ar: boolean; table: 'md_customer' | 'md_supplier'; col: RawBuilder<unknown>; module: string; classes: string[]; minus: string; type: RawBuilder<unknown>; word: string };
const AR: Side = { ar: true, table: 'md_customer', col: sql`h.customer_id`, module: 'AR', classes: ['IV', 'DR', 'CN'], minus: 'CN', type: sql`m.customer_type`, word: 'ลูกค้า' };
const AP: Side = { ar: false, table: 'md_supplier', col: sql`h.supplier_id`, module: 'AP', classes: ['RR', 'CP', 'DN'], minus: 'DN', type: sql`m.supplier_type`, word: 'ผู้จำหน่าย' };
const ROUTE: Record<string, string> = Object.fromEntries([...TRADE_KINDS, ...SETTLE_KINDS].map((k) => [k.cls, k.route]));
const money = (x: Decimal) => x.toFixed(2);
type Doc = { id: string; party_id: string; code: string; name: string; doc_no: string; doc_date: string; due_date: string | null; doc_class: string; amount: string; settled: string; credit_limit: string | null; type: string | null; slm: string | null; area: string | null };

/** เงื่อนไขคู่ค้า: ช่วงรหัส ประเภท เขต พนักงานขาย (ของคู่ค้า) */
function partyWhere(p: P, s: Side) {
  return sql`${p.range(s.ar ? 'customer' : 'supplier', sql`m.code`)} ${p.range(s.ar ? 'ctype' : 'stype', s.type)}
    ${s.ar ? sql`${p.range('area', sql`m.sales_area_code`)} ${p.range('salesperson', sql`(SELECT sp.code FROM md_salesperson sp WHERE sp.id = m.salesperson_id)`)}` : sql``}`;
}
/** เอกสารหนี้ค้าง ณ วันที่ (ยอดตามเครื่องหมาย + ยอดตัดถึงวันนั้น) */
async function docsAsOf(db: Db, a: Ctx, p: P, s: Side, asOf: string) {
  return (await sql<Doc>`SELECT h.id, m.id AS party_id, m.code, m.name, h.doc_no, h.doc_date, h.due_date, h.doc_class,
        CASE WHEN h.doc_class = ${s.minus} THEN -h.net_amount ELSE h.net_amount END AS amount,
        CASE WHEN h.doc_class = ${s.minus} THEN -1 ELSE 1 END * coalesce((SELECT sum(x.amount) FROM doc_settlement x LEFT JOIN doc_header pay ON pay.id = x.payment_header_id LEFT JOIN gl_journal j ON j.id = x.payment_journal_id
          WHERE x.invoice_header_id = h.id AND x.deleted_at IS NULL AND coalesce(pay.doc_status, 'N') <> 'C' AND coalesce(j.doc_status, 'N') <> 'C' AND coalesce(pay.doc_date, j.voucher_date) <= ${asOf}), 0) AS settled,
        m.credit_limit, ${s.type} AS type, ${s.ar ? sql`(SELECT sp.code FROM md_salesperson sp WHERE sp.id = m.salesperson_id)` : sql`NULL`} AS slm, ${s.ar ? sql`m.sales_area_code` : sql`NULL`} AS area
      FROM doc_header h JOIN ${sql.table(s.table)} m ON m.id = ${s.col} LEFT JOIN md_department dp ON dp.id = h.department_id
     WHERE h.company_id = ${a.companyId} AND h.module = ${s.module} AND h.doc_class IN (${sql.join(s.classes)}) AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND h.doc_date <= ${asOf}
       ${partyWhere(p, s)} ${p.dept(sql`dp.code`)}
     ORDER BY m.code, h.doc_date, h.doc_no`.execute(db)).rows;
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const BUCKETS = ['ยังไม่ถึงกำหนด', '1–30 วัน', '31–60 วัน', '61–90 วัน', '91–120 วัน', 'เกิน 120 วัน'];
const bucketOf = (due: string | null, docDate: string, asOf: string) => { const n = daysBetween(String(due ?? docDate).slice(0, 10), asOf); return n <= 0 ? 0 : n <= 30 ? 1 : n <= 60 ? 2 : n <= 90 ? 3 : n <= 120 ? 4 : 5; };

function outstanding(s: Side, mode: 'sum' | 'detail' | 'aging-sum' | 'aging-detail' | 'over' | 'letter') {
  return async (db: Db, a: Ctx, p: P) => {
    const asOf = p.asOf();
    const docs = (await docsAsOf(db, a, p, s, asOf)).map((x) => ({ ...x, out: d(x.amount).minus(d(x.settled)) })).filter((x) => !x.out.abs().lt('0.005'));
    const by = new Map<string, typeof docs>();
    for (const x of docs) by.set(x.party_id, [...(by.get(x.party_id) ?? []), x]);
    const rows: ReportRow[] = [];
    const sub = `${s.word} ณ วันที่ ${p.fd(asOf)}`;
    if (mode === 'sum' || mode === 'over') {
      let tot = d(0), n = 0;
      const extra = mode === 'sum' && p.bool('zero') ? (await sql<{ id: string; code: string; name: string }>`SELECT m.id, m.code, m.name FROM ${sql.table(s.table)} m WHERE m.company_id = ${a.companyId} AND m.deleted_at IS NULL ${partyWhere(p, s)} ORDER BY m.code`.execute(db)).rows : [];
      const ids = [...new Set([...by.keys(), ...extra.map((x) => x.id)])];
      const info = new Map([...docs.map((x) => [x.party_id, { code: x.code, name: x.name, limit: x.credit_limit }] as const), ...extra.map((x) => [x.id, { code: x.code, name: x.name, limit: null }] as const)]);
      ids.sort((x, y) => info.get(x)!.code.localeCompare(info.get(y)!.code));
      for (const id of ids) {
        const list = by.get(id) ?? [];
        const o = list.reduce((t, x) => t.plus(x.out), d(0));
        const inf = info.get(id)!;
        if (mode === 'over' && !(d(inf.limit ?? 0).gt(0) && o.gt(d(inf.limit ?? 0)))) continue;
        n++; tot = tot.plus(o);
        rows.push({ c: { code: inf.code, name: inf.name, docs: list.length, ...(mode === 'over' ? { limit: inf.limit, over: money(o.minus(d(inf.limit ?? 0))) } : {}), out: money(o) } });
      }
      rows.push({ t: 'total', c: { name: `รวม ${n} ราย`, out: money(tot) } });
      const columns: ReportColumn[] = [{ key: 'code', label: 'รหัส', kind: 'mono', width: 120 }, { key: 'name', label: `ชื่อ${s.word}` }, { key: 'docs', label: 'จำนวนใบ', kind: 'int', width: 80 },
        ...(mode === 'over' ? [{ key: 'limit', label: 'วงเงิน', kind: 'money' as const, width: 130 }, { key: 'over', label: 'เกินวงเงิน', kind: 'money' as const, width: 130 }] : []), { key: 'out', label: 'ยอดคงค้าง', kind: 'money', width: 150 }];
      return { subtitle: sub, columns, rows };
    }
    if (mode === 'aging-sum') {
      const tot = BUCKETS.map(() => d(0));
      for (const [, list] of by) {
        const b = BUCKETS.map(() => d(0));
        for (const x of list) b[bucketOf(x.due_date, x.doc_date, asOf)] = b[bucketOf(x.due_date, x.doc_date, asOf)]!.plus(x.out);
        b.forEach((v, i) => (tot[i] = tot[i]!.plus(v)));
        rows.push({ c: { code: list[0]!.code, name: list[0]!.name, ...Object.fromEntries(b.map((v, i) => [`b${i}`, money(v)])), out: money(b.reduce((t, v) => t.plus(v), d(0))) } });
      }
      rows.push({ t: 'total', c: { name: `รวม ${by.size} ราย`, ...Object.fromEntries(tot.map((v, i) => [`b${i}`, money(v)])), out: money(tot.reduce((t, v) => t.plus(v), d(0))) } });
      return { subtitle: sub, columns: [{ key: 'code', label: 'รหัส', kind: 'mono', width: 110 }, { key: 'name', label: `ชื่อ${s.word}` }, ...BUCKETS.map((l, i) => ({ key: `b${i}`, label: l, kind: 'money' as const, width: 115 })), { key: 'out', label: 'รวม', kind: 'money', width: 125 }] as ReportColumn[], rows };
    }
    // แบบละเอียด / อายุหนี้ละเอียด / ใบยืนยันยอด
    let tot = d(0);
    for (const [, list] of by) {
      rows.push({ t: 'group', c: { no: list[0]!.code, date: list[0]!.name } });
      if (mode === 'letter') rows.push({ t: 'note', c: { date: `เรียน ${list[0]!.name} — บริษัทขอยืนยันยอด${s.ar ? 'ลูกหนี้' : 'เจ้าหนี้'}คงค้าง ณ วันที่ ${p.fd(asOf)} ตามรายการด้านล่าง หากไม่ถูกต้องโปรดแจ้งกลับ` } });
      let g = d(0);
      for (const x of list) {
        g = g.plus(x.out);
        const over = Math.max(0, daysBetween(String(x.due_date ?? x.doc_date).slice(0, 10), asOf));
        rows.push({ c: { no: x.doc_no, date: x.doc_date, due: x.due_date, amount: x.amount, settled: x.settled, out: money(x.out), days: over || null, bucket: mode === 'aging-detail' ? BUCKETS[bucketOf(x.due_date, x.doc_date, asOf)]! : null }, link: ROUTE[x.doc_class] ? `${ROUTE[x.doc_class]}/${x.id}` : null });
      }
      tot = tot.plus(g);
      rows.push({ t: 'sub', c: { date: `รวม ${list[0]!.code} (${list.length} ใบ)`, out: money(g) } });
      if (mode === 'letter') rows.push({ t: 'note', c: { date: 'ยืนยันว่ายอดถูกต้อง ลงชื่อ ................................................ วันที่ ....................' } });
    }
    rows.push({ t: 'total', c: { date: `รวมทั้งสิ้น ${by.size} ราย`, out: money(tot) } });
    return { subtitle: sub, columns: [{ key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'due', label: 'ครบกำหนด', kind: 'date', width: 95 },
      { key: 'amount', label: 'จำนวนเงิน', kind: 'money', width: 125 }, { key: 'settled', label: s.ar ? 'รับชำระแล้ว' : 'จ่ายชำระแล้ว', kind: 'money', width: 125 }, { key: 'out', label: 'คงค้าง', kind: 'money', width: 125 },
      { key: 'days', label: 'เกินกำหนด (วัน)', kind: 'int', width: 90 }, ...(mode === 'aging-detail' ? [{ key: 'bucket', label: 'ช่วงอายุ', width: 110 }] : [])] as ReportColumn[], rows };
  };
}

/** สถานะลูกหนี้/เจ้าหนี้รายงวด (1B/2B): ยกมา + ขาย/ซื้อ + เพิ่มหนี้ − ลดหนี้ − ชำระ = คงเหลือ · แยกตามประเภท */
function status(s: Side) {
  return async (db: Db, a: Ctx, p: P) => {
    const per = p.str('period') ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) throw badRequest('งวดไม่ถูกต้อง — เลือกเดือน');
    const start = `${per}-01`, end = new Date(Date.UTC(Number(per.slice(0, 4)), Number(per.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const before = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10);
    const open = new Map<string, Decimal>();
    for (const x of await docsAsOf(db, a, p, s, before)) open.set(x.party_id, (open.get(x.party_id) ?? d(0)).plus(d(x.amount).minus(d(x.settled))));
    const mv = (await sql<{ party_id: string; code: string; name: string; type: string | null; sales: string; plus: string; minus: string; paid: string }>`
      SELECT m.id AS party_id, m.code, m.name, ${s.type} AS type,
        coalesce(sum(h.net_amount) FILTER (WHERE h.doc_class = ${s.classes[0]!} AND h.doc_date BETWEEN ${start} AND ${end}), 0) AS sales,
        coalesce(sum(h.net_amount) FILTER (WHERE h.doc_class = ${s.classes[1]!} AND h.doc_date BETWEEN ${start} AND ${end}), 0) AS plus,
        coalesce(sum(h.net_amount) FILTER (WHERE h.doc_class = ${s.minus} AND h.doc_date BETWEEN ${start} AND ${end}), 0) AS minus,
        coalesce((SELECT sum(CASE WHEN i.doc_class = ${s.minus} THEN -x.amount ELSE x.amount END) FROM doc_settlement x JOIN doc_header i ON i.id = x.invoice_header_id LEFT JOIN doc_header pay ON pay.id = x.payment_header_id LEFT JOIN gl_journal j ON j.id = x.payment_journal_id
          WHERE ${s.ar ? sql`i.customer_id` : sql`i.supplier_id`} = m.id AND i.module = ${s.module} AND i.doc_status <> 'C' AND x.deleted_at IS NULL AND coalesce(pay.doc_status, 'N') <> 'C' AND coalesce(j.doc_status, 'N') <> 'C'
            AND coalesce(pay.doc_date, j.voucher_date) BETWEEN ${start} AND ${end}), 0) AS paid
      FROM ${sql.table(s.table)} m LEFT JOIN doc_header h ON ${s.col} = m.id AND h.module = ${s.module} AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND h.doc_class IN (${sql.join(s.classes)})
     WHERE m.company_id = ${a.companyId} AND m.deleted_at IS NULL ${partyWhere(p, s)} GROUP BY m.id ORDER BY ${s.type} NULLS FIRST, m.code`.execute(db)).rows;
    const rows: ReportRow[] = [];
    const z = () => ({ n: 0, o: d(0), s: d(0), pl: d(0), mi: d(0), pa: d(0), c: d(0) });
    const tot = z(); let g = z(), gk: string | null | undefined;
    const sumRow = (x: ReturnType<typeof z>, label: string, t: 'sub' | 'total'): ReportRow => ({ t, c: { name: `${label} (${x.n} ราย)`, open: money(x.o), sales: money(x.s), plus: money(x.pl), minus: money(x.mi), paid: money(x.pa), close: money(x.c) } });
    for (const r of mv) {
      const o = open.get(r.party_id) ?? d(0);
      const c = o.plus(d(r.sales)).plus(d(r.plus)).minus(d(r.minus)).minus(d(r.paid));
      if (!p.bool('zero') && o.isZero() && c.isZero() && d(r.sales).isZero() && d(r.paid).isZero() && d(r.plus).isZero() && d(r.minus).isZero()) continue;
      if (r.type !== gk) { if (gk !== undefined) rows.push(sumRow(g, `รวมประเภท ${gk ?? '(ไม่ระบุ)'}`, 'sub')); gk = r.type; g = z(); rows.push({ t: 'group', c: { code: r.type ?? '(ไม่ระบุ)', name: `ประเภท${s.word}` } }); }
      for (const x of [tot, g]) { x.n++; x.o = x.o.plus(o); x.s = x.s.plus(d(r.sales)); x.pl = x.pl.plus(d(r.plus)); x.mi = x.mi.plus(d(r.minus)); x.pa = x.pa.plus(d(r.paid)); x.c = x.c.plus(c); }
      rows.push({ c: { code: r.code, name: r.name, open: money(o), sales: r.sales, plus: r.plus, minus: r.minus, paid: r.paid, close: money(c) } });
    }
    if (gk !== undefined) rows.push(sumRow(g, `รวมประเภท ${gk ?? '(ไม่ระบุ)'}`, 'sub'));
    rows.push(sumRow(tot, 'รวมทั้งสิ้น', 'total'));
    return { subtitle: `งวด ${p.fd(start)} – ${p.fd(end)}`, rows, columns: [{ key: 'code', label: 'รหัส', kind: 'mono', width: 110 }, { key: 'name', label: `ชื่อ${s.word}` }, { key: 'open', label: 'ยอดหนี้ยกมา', kind: 'money', width: 120 },
      { key: 'sales', label: s.ar ? 'ยอดขาย' : 'ยอดซื้อ', kind: 'money', width: 120 }, { key: 'plus', label: 'เพิ่มหนี้', kind: 'money', width: 105 }, { key: 'minus', label: s.ar ? 'ลดหนี้/รับคืน' : 'ลดหนี้/ส่งคืน', kind: 'money', width: 110 },
      { key: 'paid', label: s.ar ? 'รับชำระ' : 'จ่ายชำระ', kind: 'money', width: 120 }, { key: 'close', label: 'คงเหลือ', kind: 'money', width: 125 }] as ReportColumn[] };
  };
}

/** รายการเคลื่อนไหวลูกหนี้/เจ้าหนี้ (1D/2D): ยกมา + เอกสารหนี้และรายการชำระตามวันที่ + คงเหลือสะสม */
function movement(s: Side) {
  return async (db: Db, a: Ctx, p: P) => {
    const [from, to] = p.dates('date');
    const start = from ?? '1900-01-01', end = to ?? '2999-12-31';
    const open = new Map<string, Decimal>();
    for (const x of await docsAsOf(db, a, p, s, new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10))) open.set(x.party_id, (open.get(x.party_id) ?? d(0)).plus(d(x.amount).minus(d(x.settled))));
    const ev = (await sql<{ party_id: string; code: string; name: string; id: string; doc_no: string; doc_date: string; doc_class: string; debit: string; credit: string }>`
      SELECT * FROM (
        SELECT m.id AS party_id, m.code, m.name, h.id, h.doc_no, h.doc_date, h.doc_class, CASE WHEN h.doc_class = ${s.minus} THEN 0 ELSE h.net_amount END AS debit, CASE WHEN h.doc_class = ${s.minus} THEN h.net_amount ELSE 0 END AS credit
          FROM doc_header h JOIN ${sql.table(s.table)} m ON m.id = ${s.col}
         WHERE h.company_id = ${a.companyId} AND h.module = ${s.module} AND h.doc_class IN (${sql.join(s.classes)}) AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND h.doc_date BETWEEN ${start} AND ${end} ${partyWhere(p, s)}
        UNION ALL
        SELECT m.id, m.code, m.name, coalesce(pay.id, i.id), coalesce(pay.doc_no, j.voucher_no), coalesce(pay.doc_date, j.voucher_date), coalesce(pay.doc_class, 'JV'),
               CASE WHEN i.doc_class = ${s.minus} THEN sum(x.amount) ELSE 0 END, CASE WHEN i.doc_class = ${s.minus} THEN 0 ELSE sum(x.amount) END
          FROM doc_settlement x JOIN doc_header i ON i.id = x.invoice_header_id JOIN ${sql.table(s.table)} m ON m.id = ${s.ar ? sql`i.customer_id` : sql`i.supplier_id`}
          LEFT JOIN doc_header pay ON pay.id = x.payment_header_id LEFT JOIN gl_journal j ON j.id = x.payment_journal_id
         WHERE i.company_id = ${a.companyId} AND i.module = ${s.module} AND i.doc_status <> 'C' AND x.deleted_at IS NULL AND coalesce(pay.doc_status, 'N') <> 'C' AND coalesce(j.doc_status, 'N') <> 'C'
           AND coalesce(pay.doc_date, j.voucher_date) BETWEEN ${start} AND ${end} ${partyWhere(p, s)}
         GROUP BY m.id, m.code, m.name, pay.id, i.id, pay.doc_no, j.voucher_no, pay.doc_date, j.voucher_date, pay.doc_class, i.doc_class
      ) e ORDER BY code, doc_date, doc_no LIMIT 50000`.execute(db)).rows;
    const rows: ReportRow[] = [];
    const parties = [...new Set([...ev.map((x) => x.party_id), ...[...open.entries()].filter(([, v]) => !v.isZero()).map(([k]) => k)])];
    const nameOf = new Map(ev.map((x) => [x.party_id, { code: x.code, name: x.name }]));
    if (parties.some((x) => !nameOf.has(x))) for (const r of (await sql<{ id: string; code: string; name: string }>`SELECT id, code, name FROM ${sql.table(s.table)} WHERE id IN (${sql.join(parties)})`.execute(db)).rows) nameOf.set(r.id, { code: r.code, name: r.name });
    parties.sort((x, y) => nameOf.get(x)!.code.localeCompare(nameOf.get(y)!.code));
    let tD = d(0), tC = d(0), tO = d(0), tE = d(0);
    for (const pid of parties) {
      const n = nameOf.get(pid)!;
      let bal = open.get(pid) ?? d(0);
      tO = tO.plus(bal);
      rows.push({ t: 'group', c: { no: n.code, desc: n.name } });
      rows.push({ c: { desc: 'ยอดยกมา', bal: money(bal) }, muted: true });
      for (const x of ev.filter((e) => e.party_id === pid)) {
        bal = bal.plus(d(x.debit)).minus(d(x.credit)); tD = tD.plus(d(x.debit)); tC = tC.plus(d(x.credit));
        rows.push({ c: { date: x.doc_date, no: x.doc_no, desc: x.doc_class, debit: x.debit, credit: x.credit, bal: money(bal) }, link: ROUTE[x.doc_class] ? `${ROUTE[x.doc_class]}/${x.id}` : null });
      }
      tE = tE.plus(bal);
      rows.push({ t: 'sub', c: { desc: `คงเหลือ ${n.code}`, bal: money(bal) } });
    }
    rows.push({ t: 'total', c: { desc: `รวม ${parties.length} ราย (ยกมา ${money(tO)})`, debit: money(tD), credit: money(tC), bal: money(tE) } });
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows, columns: [{ key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'desc', label: 'รายการ' },
      { key: 'debit', label: s.ar ? 'เพิ่มหนี้ (เดบิต)' : 'เพิ่มหนี้ (เครดิต)', kind: 'money', width: 130 }, { key: 'credit', label: 'ลดหนี้/ชำระ', kind: 'money', width: 130 }, { key: 'bal', label: 'คงเหลือ', kind: 'money', width: 135 }] as ReportColumn[] };
  };
}

/** รายละเอียดลูกค้า/ผู้จำหน่าย (1F/2F) */
function partyList(s: Side) {
  return async (db: Db, a: Ctx, p: P) => {
    const rows = (await sql<Record<string, string | null>>`SELECT m.code, m.name, ${s.type} AS type, m.tax_id, m.tax_branch_no, concat_ws(' ', m.address_1, m.address_2, m.address_3, m.zip_code) AS address, m.phone, m.contact, m.credit_days::text AS credit_days, m.credit_limit, m.status
        ${s.ar ? sql`, m.sales_area_code AS area, (SELECT sp.code FROM md_salesperson sp WHERE sp.id = m.salesperson_id) AS slm` : sql``}
      FROM ${sql.table(s.table)} m WHERE m.company_id = ${a.companyId} AND m.deleted_at IS NULL ${partyWhere(p, s)} ORDER BY m.code`.execute(db)).rows;
    return { subtitle: `${rows.length.toLocaleString()} ราย`, rows: [...rows.map((r) => ({ c: { ...r, status: r.status === 'A' ? '' : 'เลิกใช้' }, muted: r.status !== 'A' })), { t: 'total' as const, c: { name: `รวม ${rows.length} ราย` } }],
      columns: [{ key: 'code', label: 'รหัส', kind: 'mono', width: 110 }, { key: 'name', label: 'ชื่อ' }, { key: 'type', label: 'ประเภท', width: 60 }, { key: 'tax_id', label: 'เลขผู้เสียภาษี', kind: 'mono', width: 120 },
        { key: 'address', label: 'ที่อยู่' }, { key: 'phone', label: 'โทรศัพท์', width: 110 }, { key: 'contact', label: 'ผู้ติดต่อ', width: 110 }, ...(s.ar ? [{ key: 'area', label: 'เขต', width: 50 }, { key: 'slm', label: 'พนักงานขาย', width: 80 }] : []),
        { key: 'credit_days', label: 'เครดิต (วัน)', kind: 'int', width: 70 }, { key: 'credit_limit', label: 'วงเงิน', kind: 'money', width: 110 }, { key: 'status', label: 'สถานะ', width: 60 }] as ReportColumn[] };
  };
}

/** ตรวจสอบข้อมูลระบบขาย/ซื้อ (1H/2G): หนี้คงค้างติดลบ (ตัดเกิน) · เอกสารที่ไม่มีใบสำคัญ · ใบสำคัญไม่ดุล · คู่ค้าไม่มีเลขผู้เสียภาษี */
function dataCheck(s: Side) {
  return async (db: Db, a: Ctx, p: P) => {
    const [from, to] = p.dates('date');
    const rng = sql`${from ? sql`AND h.doc_date >= ${from}` : sql``} ${to ? sql`AND h.doc_date <= ${to}` : sql``}`;
    const view = sql.table(s.ar ? 'v_ar_outstanding' : 'v_ap_outstanding');
    const issues = (await sql<{ kind: string; doc_no: string; doc_date: string; id: string; doc_class: string; detail: string }>`
      SELECT 'ตัดชำระเกินยอดเอกสาร' AS kind, h.doc_no, h.doc_date, h.id, h.doc_class, 'คงค้าง ' || o.outstanding::text AS detail FROM ${view} o JOIN doc_header h ON h.id = o.header_id
       WHERE o.company_id = ${a.companyId} AND ((h.doc_class <> ${s.minus} AND o.outstanding < -0.004) OR (h.doc_class = ${s.minus} AND o.outstanding > 0.004)) ${rng}
      UNION ALL
      SELECT 'ยังไม่ลงบัญชี', h.doc_no, h.doc_date, h.id, h.doc_class, 'ไม่มีใบสำคัญของเอกสาร' FROM doc_header h
       WHERE h.company_id = ${a.companyId} AND h.module = ${s.module} AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND NOT h.is_opening AND h.doc_class IN (${sql.join([...s.classes, s.ar ? 'RE' : 'PS'])}) ${rng}
         AND NOT EXISTS (SELECT 1 FROM gl_journal j WHERE j.source_header_id = h.id AND j.doc_status <> 'C' AND j.deleted_at IS NULL) AND h.journal_id IS NULL
      UNION ALL
      SELECT 'ใบสำคัญไม่ดุล', h.doc_no, h.doc_date, h.id, h.doc_class, j.voucher_no || ' เดบิต ' || j.total_debit::text || ' เครดิต ' || j.total_credit::text FROM gl_journal j JOIN doc_header h ON h.id = j.source_header_id
       WHERE j.company_id = ${a.companyId} AND h.module = ${s.module} AND j.doc_status <> 'C' AND j.deleted_at IS NULL AND j.total_debit <> j.total_credit ${rng}
      ORDER BY 1, 3, 2 LIMIT 5000`.execute(db)).rows;
    const noTax = (await sql<{ code: string; name: string }>`SELECT code, name FROM ${sql.table(s.table)} WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND status = 'A' AND coalesce(tax_id, '') = '' ORDER BY code LIMIT 2000`.execute(db)).rows;
    const rows: ReportRow[] = [];
    let k: string | null = null;
    for (const x of issues) {
      if (x.kind !== k) { k = x.kind; rows.push({ t: 'group', c: { kind: x.kind } }); }
      rows.push({ c: { no: x.doc_no, date: x.doc_date, detail: x.detail }, link: ROUTE[x.doc_class] ? `${ROUTE[x.doc_class]}/${x.id}` : null });
    }
    if (noTax.length) { rows.push({ t: 'group', c: { kind: `${s.word}ที่ยังไม่มีเลขผู้เสียภาษี (${noTax.length})` } }); for (const x of noTax) rows.push({ c: { no: x.code, detail: x.name } }); }
    rows.push({ t: 'total', c: { kind: issues.length || noTax.length ? `พบ ${issues.length + noTax.length} รายการ` : 'ไม่พบข้อผิดพลาด' } });
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows, columns: [{ key: 'kind', label: 'เรื่อง', width: 200 }, { key: 'no', label: 'เลขที่/รหัส', kind: 'mono', width: 140 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'detail', label: 'รายละเอียด' }] as ReportColumn[] };
  };
}

export function partyReports() {
  for (const [s, g] of [[AR, '1'], [AP, '2']] as const) {
    defineReport(`${g}.A.1`, outstanding(s, 'sum'));
    defineReport(`${g}.A.2`, outstanding(s, 'detail'));
    defineReport(`${g}.C.1`, outstanding(s, 'aging-sum'));
    defineReport(`${g}.C.2`, outstanding(s, 'aging-detail'));
    defineReport(`${g}.E`, outstanding(s, 'over'));
    defineReport(`${g}.B`, status(s));
    defineReport(`${g}.D`, movement(s));
    defineReport(`${g}.F`, partyList(s));
    defineReport(s.ar ? '1.H' : '2.G', dataCheck(s));
    defineReport(s.ar ? '1.4.A' : '2.4.6', outstanding(s, 'letter'));
  }
}
