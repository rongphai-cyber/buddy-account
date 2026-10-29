import { sql } from 'kysely';
import { d, type ReportRow } from '@buddy/core';
import { defineReport } from './index.js';

/**
 * 4.6 ตรวจยอดสินค้า (คู่มือบทที่ 21 S-CK-07 พิมพ์รายงานตรวจยอดยกมา) — Buddy ไม่มีแฟ้มยอดยกมาหลายชุดที่คลาดกันได้ ยอดคำนวณจากเอกสารเสมอ
 * จึงตรวจสิ่งที่ผิดได้จริง: ยอดติดลบ · จำนวนเป็นศูนย์แต่ยังมีมูลค่า · ต่างจากยอดคงเหลือที่ย้ายมาจาก Express (STLOC ณ วันย้ายระบบ)
 */
export function checkReports() {
  defineReport('4.6', async (db, a, p) => {
    const asOf = p.asOf() ?? new Date().toISOString().slice(0, 10);
    const [from, to] = [p.str('item_from'), p.str('item_to')];
    const withSnap = p.bool('snapshot');
    const rows = (await sql<{ code: string; name: string; wh: string; qty: string; value: string; snap_qty: string | null; snap_value: string | null }>`
      WITH live AS (SELECT item_id, warehouse_id, sum(qty) AS qty, sum(value) AS value FROM v_stock_move WHERE company_id = ${a.companyId} AND doc_date <= ${asOf} GROUP BY 1, 2),
           snap AS (SELECT item_id, warehouse_id, qty_on_hand AS qty, value_on_hand AS value FROM inv_stock_balance WHERE company_id = ${a.companyId} AND deleted_at IS NULL AND item_id IS NOT NULL AND warehouse_id IS NOT NULL)
      SELECT i.code, i.name_th AS name, w.code AS wh, coalesce(l.qty, 0) AS qty, coalesce(l.value, 0) AS value, s.qty AS snap_qty, s.value AS snap_value
        FROM live l FULL JOIN snap s ON s.item_id = l.item_id AND s.warehouse_id = l.warehouse_id
        JOIN md_item i ON i.id = coalesce(l.item_id, s.item_id) JOIN md_warehouse w ON w.id = coalesce(l.warehouse_id, s.warehouse_id)
       WHERE i.company_id = ${a.companyId} ${from ? sql`AND i.code >= ${from}` : sql``} ${to ? sql`AND i.code <= ${to}` : sql``}
       ORDER BY i.code, w.code`.execute(db)).rows;
    const out: ReportRow[] = [];
    const count: Record<string, number> = {};
    for (const r of rows) {
      const q = d(r.qty), v = d(r.value);
      const issues: string[] = [];
      if (q.lt(0)) issues.push('จำนวนติดลบ');
      if (v.lt(0)) issues.push('มูลค่าติดลบ');
      if (q.isZero() && !v.abs().lt('0.01')) issues.push('จำนวนเป็น 0 แต่มีมูลค่า');
      if (withSnap && r.snap_qty !== null && (!q.minus(r.snap_qty).abs().lt('0.0005') || !v.minus(r.snap_value ?? 0).abs().lt('0.005'))) issues.push('ต่างจากยอดที่ย้ายมาจาก Express');
      if (!issues.length) continue;
      for (const x of issues) count[x] = (count[x] ?? 0) + 1;
      out.push({ c: { code: r.code, name: r.name, wh: r.wh, qty: q.toString(), value: v.toFixed(2), snap_qty: r.snap_qty === null ? '' : d(r.snap_qty).toString(), snap_value: r.snap_value === null ? '' : d(r.snap_value).toFixed(2), issue: issues.join(' · ') } });
    }
    out.push({ t: 'total', c: { name: out.length ? `พบ ${out.length.toLocaleString()} รายการ — ${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(' · ')}` : 'ไม่พบรายการผิดปกติ' } });
    return { subtitle: `ณ วันที่ ${p.fd(asOf)}${withSnap ? ' · เทียบยอดที่ย้ายมาจาก Express' : ''}`, rows: out, columns: [{ key: 'code', label: 'รหัสสินค้า', kind: 'mono', width: 130 }, { key: 'name', label: 'ชื่อสินค้า' },
      { key: 'wh', label: 'คลัง', width: 60 }, { key: 'qty', label: 'จำนวน', kind: 'qty' }, { key: 'value', label: 'มูลค่า', kind: 'money' }, { key: 'snap_qty', label: 'จำนวน (Express)', kind: 'qty' },
      { key: 'snap_value', label: 'มูลค่า (Express)', kind: 'money' }, { key: 'issue', label: 'ปัญหา' }] };
  });
}
