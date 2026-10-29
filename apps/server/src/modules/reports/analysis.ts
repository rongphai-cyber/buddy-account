import { sql } from 'kysely';
import { d, type Decimal, type ReportColumn, type ReportRow, TRADE_KINDS } from '@buddy/core';
import { defineReport, type Ctx, type P } from './index.js';
import type { Db } from '../../db.js';

/**
 * วิเคราะห์การขาย (กลุ่ม 7) และการซื้อ (กลุ่ม 8) — จากบรรทัดเอกสาร: ขาย IV HS (+) ลดหนี้ CN (−) · ซื้อ RR HP (+) ส่งคืน DN (−)
 * มูลค่า = ยอดสุทธิก่อน VAT หลังส่วนลดของบรรทัด · ต้นทุนขาย = ต้นทุนที่ตัดสต๊อก (กำไรขั้นต้นโดยประมาณ)
 */
const money = (x: Decimal) => x.toFixed(2);
const ROUTE: Record<string, string> = Object.fromEntries(TRADE_KINDS.map((k) => [k.cls, k.route]));
type Line = { header_id: string; doc_class: string; doc_no: string; doc_date: string; party_code: string | null; party_name: string | null; slm_code: string | null; slm_name: string | null;
  item_code: string | null; item_name: string | null; qty: string; unit: string | null; unit_price: string | null; net: string; cost: string | null };

async function lines(db: Db, a: Ctx, p: P, sales: boolean) {
  const party = sales ? sql`c.code` : sql`s.code`;
  return (await sql<Line>`SELECT h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, ${party} AS party_code, coalesce(h.party_name, c.name, s.name) AS party_name, sp.code AS slm_code, sp.name AS slm_name,
        i.code AS item_code, coalesce(l.description, i.name_th) AS item_name,
        CASE WHEN h.doc_class IN ('CN', 'DN') THEN -l.qty ELSE l.qty END AS qty, u.code AS unit, l.unit_price,
        CASE WHEN h.doc_class IN ('CN', 'DN') THEN -l.net_amount ELSE l.net_amount END AS net,
        (SELECT -sum(coalesce(k.cost_amount, 0) * k.stock_effect) FROM doc_line k WHERE (k.id = l.id OR (k.source_line_id = l.id AND k.line_kind = 'K')) AND k.deleted_at IS NULL) AS cost
      FROM doc_line l JOIN doc_header h ON h.id = l.header_id LEFT JOIN md_item i ON i.id = l.item_id LEFT JOIN md_unit u ON u.id = l.unit_id
      LEFT JOIN md_customer c ON c.id = h.customer_id LEFT JOIN md_supplier s ON s.id = h.supplier_id LEFT JOIN md_salesperson sp ON sp.id = h.salesperson_id
     WHERE h.company_id = ${a.companyId} AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND h.module <> 'IC' AND NOT h.is_opening AND l.deleted_at IS NULL AND l.line_kind IN ('I', 'G')
       AND h.doc_class IN (${sql.join(sales ? ['IV', 'HS', 'CN'] : ['RR', 'HP', 'DN'])})
       ${p.dateRange('date', sql`h.doc_date`)} ${p.range('item', sql`i.code`)} ${p.range(sales ? 'customer' : 'supplier', party)} ${sales ? p.range('salesperson', sql`sp.code`) : sql``}
     ORDER BY h.doc_date, h.doc_no, l.line_no LIMIT 100001`.execute(db)).rows;
}

function history(sales: boolean, by: 'party' | 'item' | 'salesperson') {
  return async (db: Db, a: Ctx, p: P) => {
    const ls = await lines(db, a, p, sales);
    const truncated = ls.length > 100000; if (truncated) ls.pop();
    const key = (l: Line) => by === 'party' ? `${l.party_code ?? ''}|${l.party_name ?? ''}` : by === 'item' ? `${l.item_code ?? '(ไม่มีรหัส)'}|${l.item_name ?? ''}` : `${l.slm_code ?? '(ไม่ระบุ)'}|${l.slm_name ?? ''}`;
    const groups = new Map<string, Line[]>();
    for (const l of ls) { const k = key(l); groups.set(k, [...(groups.get(k) ?? []), l]); }
    const keys = [...groups.keys()].sort();
    const rows: ReportRow[] = [];
    let tq = d(0), tn = d(0), tc = d(0);
    for (const k of keys) {
      const [code, name] = k.split('|');
      rows.push({ t: 'group', c: { date: code ?? '', party: name ?? '' } });
      let q = d(0), n = d(0), c = d(0);
      for (const l of groups.get(k)!) {
        q = q.plus(d(l.qty)); n = n.plus(d(l.net)); c = c.plus(d(l.cost ?? 0));
        rows.push({ c: { date: l.doc_date, no: l.doc_no, party: by === 'party' ? `${l.item_code ?? ''} ${l.item_name ?? ''}` : `${l.party_code ?? ''} ${l.party_name ?? ''}`,
          qty: l.qty, unit: l.unit, price: l.unit_price, net: l.net, ...(sales ? { cost: l.cost, gp: money(d(l.net).minus(d(l.cost ?? 0))) } : {}) }, link: ROUTE[l.doc_class] ? `${ROUTE[l.doc_class]}/${l.header_id}` : null });
      }
      tq = tq.plus(q); tn = tn.plus(n); tc = tc.plus(c);
      rows.push({ t: 'sub', c: { party: `รวม ${code}`, ...(by === 'item' ? { qty: q.toString() } : {}), net: money(n), ...(sales ? { cost: money(c), gp: money(n.minus(c)) } : {}) } });
    }
    rows.push({ t: 'total', c: { party: `รวมทั้งสิ้น ${keys.length} กลุ่ม`, net: money(tn), ...(sales ? { cost: money(tc), gp: money(tn.minus(tc)) } : {}) } });
    void tq;
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', truncated, rows, columns: [{ key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'no', label: 'เลขที่', kind: 'mono', width: 125 },
      { key: 'party', label: by === 'party' ? 'สินค้า' : sales ? 'ลูกค้า' : 'ผู้จำหน่าย' }, { key: 'qty', label: 'จำนวน', kind: 'qty', width: 95 }, { key: 'unit', label: 'หน่วย', width: 55 },
      { key: 'price', label: 'ราคา/หน่วย', kind: 'money', width: 105 }, { key: 'net', label: 'จำนวนเงิน', kind: 'money', width: 125 },
      ...(sales ? [{ key: 'cost', label: 'ต้นทุน', kind: 'money' as const, width: 115 }, { key: 'gp', label: 'กำไรขั้นต้น', kind: 'money' as const, width: 115 }] : [])] as ReportColumn[] };
  };
}

function summary(sales: boolean) {
  return async (db: Db, a: Ctx, p: P) => {
    const by = p.str('by') ?? 'item';
    const ls = await lines(db, a, p, sales);
    const truncated = ls.length > 100000; if (truncated) ls.pop();
    const key = (l: Line) => by === 'customer' || by === 'supplier' ? `${l.party_code ?? ''}|${l.party_name ?? ''}` : by === 'salesperson' ? `${l.slm_code ?? '(ไม่ระบุ)'}|${l.slm_name ?? ''}`
      : by === 'month' ? `${String(l.doc_date).slice(0, 7)}|` : `${l.item_code ?? '(ไม่มีรหัส)'}|${l.item_name ?? ''}`;
    const m = new Map<string, { q: Decimal; n: Decimal; c: Decimal; docs: Set<string> }>();
    for (const l of ls) {
      const k = key(l), x = m.get(k) ?? { q: d(0), n: d(0), c: d(0), docs: new Set<string>() };
      x.q = x.q.plus(d(l.qty)); x.n = x.n.plus(d(l.net)); x.c = x.c.plus(d(l.cost ?? 0)); x.docs.add(l.header_id); m.set(k, x);
    }
    const rows: ReportRow[] = [];
    let tn = d(0), tc = d(0);
    for (const k of [...m.keys()].sort()) {
      const x = m.get(k)!; const [code, name] = k.split('|');
      tn = tn.plus(x.n); tc = tc.plus(x.c);
      rows.push({ c: { code: by === 'month' ? p.fd(`${code}-01`).slice(3) : code ?? '', name: name ?? '', docs: x.docs.size, qty: by === 'item' ? x.q.toString() : null, net: money(x.n),
        ...(sales ? { cost: money(x.c), gp: money(x.n.minus(x.c)), pct: x.n.isZero() ? null : x.n.minus(x.c).div(x.n).times(100).toFixed(2) } : {}) } });
    }
    rows.push({ t: 'total', c: { name: `รวม ${m.size} รายการ`, net: money(tn), ...(sales ? { cost: money(tc), gp: money(tn.minus(tc)), pct: tn.isZero() ? null : tn.minus(tc).div(tn).times(100).toFixed(2) } : {}) } });
    const LABEL: Record<string, string> = { item: 'สินค้า', customer: 'ลูกค้า', supplier: 'ผู้จำหน่าย', salesperson: 'พนักงานขาย', month: 'เดือน' };
    return { title: `${sales ? 'สรุปยอดขาย' : 'สรุปยอดซื้อ'} ตาม${LABEL[by] ?? by}`, subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', truncated, rows,
      columns: [{ key: 'code', label: by === 'month' ? 'เดือน' : 'รหัส', kind: 'mono', width: 140 }, { key: 'name', label: by === 'month' ? '' : 'ชื่อ' }, { key: 'docs', label: 'จำนวนเอกสาร', kind: 'int', width: 90 },
        ...(by === 'item' ? [{ key: 'qty', label: 'จำนวน', kind: 'qty' as const, width: 105 }] : []), { key: 'net', label: sales ? 'ยอดขาย' : 'ยอดซื้อ', kind: 'money', width: 135 },
        ...(sales ? [{ key: 'cost', label: 'ต้นทุน', kind: 'money' as const, width: 125 }, { key: 'gp', label: 'กำไรขั้นต้น', kind: 'money' as const, width: 125 }, { key: 'pct', label: '% กำไร', kind: 'money' as const, width: 70 }] : [])] as ReportColumn[] };
  };
}

export function analysisReports() {
  defineReport('7.1.1', history(true, 'party'));
  defineReport('7.1.2', history(true, 'item'));
  defineReport('7.1.3', history(true, 'salesperson'));
  defineReport('7.6', summary(true));
  defineReport('8.1', history(false, 'party'));
  defineReport('8.2', summary(false));
}
