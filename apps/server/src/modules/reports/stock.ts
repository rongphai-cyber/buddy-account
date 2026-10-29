import { sql } from 'kysely';
import { d, type Decimal, type ReportColumn, type ReportRow, STOCK_KINDS, TRADE_KINDS } from '@buddy/core';
import { defineReport, type P } from './index.js';

/**
 * รายงานเช็ค (กลุ่ม 3) และสินค้าคงคลัง (กลุ่ม 4) — เช็คจากทะเบียน fin_cheque (สถานะปัจจุบัน + ประวัติ) · สต๊อกคำนวณสดจาก v_stock_move
 */
const money = (x: Decimal) => x.toFixed(2);
const ST: Record<string, string> = { '00': 'ในมือ', '01': 'รอเรียกเก็บ', '02': 'คืนยื่นใหม่', '05': 'เช็คจ่าย', '10': 'ผ่าน', '19': 'ผ่าน(โอน)', '20': 'เช็คคืน', '21': 'หนี้สูญ' };
const DOC_ROUTE: Record<string, string> = Object.fromEntries([...TRADE_KINDS, ...STOCK_KINDS].map((k) => [k.cls, k.route]));

type Chq = { id: string; cheque_no: string; cheque_date: string; received_date: string | null; deposit_date: string | null; pass_date: string | null; amount: string; status: string; bank: string | null; bank_branch: string | null;
  account: string | null; party: string | null; doc_no: string | null; event_date: string | null; reason: string | null };
function chequeReport(dir: 'R' | 'P', where: (p: P) => ReturnType<typeof sql>, opts: { order: string; returned?: boolean; dateLabel?: string } = { order: 'f.cheque_date' }) {
  return async (db: Parameters<Parameters<typeof defineReport>[1]>[0], a: { companyId: string }, p: P) => {
    const rows = (await sql<Chq>`SELECT f.id, f.cheque_no, f.cheque_date, f.received_date, f.deposit_date, f.pass_date, f.amount, f.status, b.code AS bank, f.bank_branch, ba.code AS account,
          coalesce(f.payee_name, c.name, s.name) AS party, h.doc_no ${opts.returned ? sql`, e.event_date, e.reason` : sql`, NULL AS event_date, NULL AS reason`}
        FROM fin_cheque f LEFT JOIN md_bank b ON b.id = f.bank_id LEFT JOIN md_bank_account ba ON ba.id = f.bank_account_id LEFT JOIN md_customer c ON c.id = f.customer_id LEFT JOIN md_supplier s ON s.id = f.supplier_id
        LEFT JOIN doc_header h ON h.id = f.source_header_id ${opts.returned ? sql`JOIN fin_cheque_event e ON e.cheque_id = f.id AND e.to_status = '20'` : sql``}
       WHERE f.company_id = ${a.companyId} AND f.deleted_at IS NULL AND f.direction = ${dir} AND f.instrument = 'CHEQUE' ${where(p)}
         ${p.range('bank', sql`ba.code`)} ${dir === 'R' ? p.range('customer', sql`c.code`) : p.range('supplier', sql`s.code`)}
       ORDER BY ${sql.raw(opts.order)}, f.cheque_no LIMIT 20000`.execute(db)).rows;
    let tot = d(0);
    const out: ReportRow[] = rows.map((r) => { tot = tot.plus(d(r.amount)); return { c: { date: r.cheque_date, no: r.cheque_no, bank: [r.bank, r.bank_branch].filter(Boolean).join(' '), party: r.party, amount: r.amount, account: r.account,
      received: r.received_date, deposit: r.deposit_date, pass: r.pass_date, ret: r.event_date, reason: r.reason, status: ST[r.status] ?? r.status, doc: r.doc_no } }; });
    out.push({ t: 'total', c: { party: `รวม ${rows.length} ใบ`, amount: money(tot) } });
    const columns: ReportColumn[] = [{ key: 'date', label: 'วันที่เช็ค', kind: 'date', width: 90 }, { key: 'no', label: 'เลขที่เช็ค', kind: 'mono', width: 120 },
      ...(dir === 'R' ? [{ key: 'bank', label: 'ธนาคาร/สาขา', width: 130 }] : []), { key: 'party', label: dir === 'R' ? 'ลูกค้า/ผู้สั่งจ่าย' : 'จ่ายให้' }, { key: 'amount', label: 'จำนวนเงิน', kind: 'money', width: 120 },
      { key: 'account', label: dir === 'R' ? 'นำฝากบัญชี' : 'ตัดจากบัญชี', width: 80 }, ...(dir === 'R' ? [{ key: 'received', label: 'วันที่รับ', kind: 'date' as const, width: 90 }, { key: 'deposit', label: 'วันที่นำฝาก', kind: 'date' as const, width: 90 }] : []),
      { key: 'pass', label: 'วันที่ผ่าน', kind: 'date', width: 90 }, ...(opts.returned ? [{ key: 'ret', label: 'วันที่คืน', kind: 'date' as const, width: 90 }, { key: 'reason', label: 'เหตุผล' }] : []),
      { key: 'status', label: 'สถานะ', width: 80 }, { key: 'doc', label: 'เอกสาร', kind: 'mono', width: 120 }];
    return { subtitle: p.describe({ date: opts.dateLabel ?? 'วันที่' }) || (p.str('as_of') ? `ณ วันที่ ${p.fd(p.asOf())}` : 'ทั้งหมด'), rows: out, columns };
  };
}

export function stockReports() {
  const asOfRecv = (col: string) => (p: P) => sql`AND coalesce(${sql.ref(col)}, f.cheque_date) <= ${p.asOf()}`;
  defineReport('3.1', chequeReport('R', (p) => sql`AND f.status IN ('00', '02') ${asOfRecv('f.received_date')(p)}`));
  defineReport('3.2', chequeReport('R', (p) => sql`AND f.status = '01' AND coalesce(f.deposit_date, f.cheque_date) <= ${p.asOf()}`, { order: 'f.deposit_date' }));
  defineReport('3.3', chequeReport('R', (p) => sql`AND f.status = '10' ${p.dateRange('date', sql`f.pass_date`)}`, { order: 'f.pass_date', dateLabel: 'วันที่ผ่าน' }));
  defineReport('3.4', chequeReport('R', (p) => p.dateRange('date', sql`e.event_date`), { order: 'e.event_date', returned: true, dateLabel: 'วันที่คืน' }));
  defineReport('3.5', chequeReport('R', (p) => p.dateRange('date', sql`coalesce(f.received_date, f.cheque_date)`), { order: 'coalesce(f.received_date, f.cheque_date)', dateLabel: 'วันที่รับเช็ค' }));
  defineReport('3.6', chequeReport('P', (p) => sql`AND f.status IN ('00', '02', '05') AND f.cheque_date <= ${p.asOf()}`));
  defineReport('3.7', chequeReport('P', (p) => sql`AND f.status = '10' ${p.dateRange('date', sql`f.pass_date`)}`, { order: 'f.pass_date', dateLabel: 'วันที่ผ่าน' }));
  defineReport('3.A', chequeReport('P', (p) => p.dateRange('date', sql`f.cheque_date`), { order: 'f.cheque_date', dateLabel: 'วันที่ออกเช็ค' }));

  // 3.B ใบนำฝากเช็ค + รายการเช็ค
  defineReport('3.B', async (db, a, p) => {
    const slips = (await sql<{ id: string; doc_no: string; doc_date: string; account: string | null; amount: string; net_amount: string; doc_status: string; discount: boolean; passed: boolean }>`
      SELECT h.id, h.doc_no, h.doc_date, ba.code AS account, h.amount, h.net_amount, h.doc_status, h.express_rectype = 'S' AS discount, h.journal_id IS NOT NULL AS passed
        FROM doc_header h LEFT JOIN md_bank_account ba ON ba.id = h.bank_account_id
       WHERE h.company_id = ${a.companyId} AND h.doc_class = 'BQ' AND h.deleted_at IS NULL AND h.doc_status <> 'C' ${p.dateRange('date', sql`h.doc_date`)} ${p.range('bank', sql`ba.code`)} ORDER BY h.doc_date, h.doc_no`.execute(db)).rows;
    const chq = slips.length && p.bool('detail') ? (await sql<{ deposit_header_id: string; cheque_no: string; cheque_date: string; bank: string | null; amount: string }>`SELECT f.deposit_header_id, f.cheque_no, f.cheque_date, b.code AS bank, f.amount
        FROM fin_cheque f LEFT JOIN md_bank b ON b.id = f.bank_id WHERE f.deposit_header_id IN (${sql.join(slips.map((s) => s.id))}) AND f.deleted_at IS NULL ORDER BY f.cheque_date`.execute(db)).rows : [];
    const rows: ReportRow[] = [];
    let tot = d(0), net = d(0);
    for (const s of slips) {
      tot = tot.plus(d(s.amount)); net = net.plus(d(s.net_amount));
      rows.push({ c: { no: s.doc_no, date: s.doc_date, account: s.account, kind: s.discount ? 'ขายลด' : 'นำฝาก', status: s.passed ? 'ผ่านแล้ว' : 'รอเรียกเก็บ', amount: s.amount, net: s.net_amount }, link: `/fi/cheques/slips/${s.id}` });
      for (const c of chq.filter((x) => x.deposit_header_id === s.id)) rows.push({ t: 'detail', c: { no: c.cheque_no, date: c.cheque_date, account: c.bank, amount: c.amount } });
    }
    rows.push({ t: 'total', c: { kind: `รวม ${slips.length} ใบ`, amount: money(tot), net: money(net) } });
    return { subtitle: p.describe({ date: 'วันที่นำฝาก' }) || 'ทั้งหมด', rows, columns: [{ key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'date', label: 'วันที่', kind: 'date', width: 95 },
      { key: 'account', label: 'บัญชี/ธนาคาร', width: 110 }, { key: 'kind', label: 'ชนิด' }, { key: 'status', label: 'สถานะ', width: 100 }, { key: 'amount', label: 'ยอดรวม', kind: 'money', width: 130 }, { key: 'net', label: 'เข้าบัญชีสุทธิ', kind: 'money', width: 130 }] };
  });

  // 4.1.1 / 4.1.5 แจกแจงรับ-จ่าย: ยกมา + รายการรับ/จ่าย + คงเหลือ (รวมทุกคลัง / แยกคลัง)
  for (const [code, byWh] of [['4.1.1', false], ['4.1.5', true]] as const) defineReport(code, async (db, a, p) => {
    const [from, to] = p.dates('date');
    const start = from ?? '1900-01-01', end = to ?? '2999-12-31';
    const key = byWh ? sql`m.item_id, m.warehouse_id` : sql`m.item_id`;
    const opening = (await sql<{ item_id: string; warehouse_id: string | null; qty: string; value: string }>`SELECT m.item_id, ${byWh ? sql`m.warehouse_id` : sql`NULL`} AS warehouse_id, sum(m.qty) AS qty, sum(m.value) AS value
        FROM v_stock_move m JOIN md_item i ON i.id = m.item_id JOIN md_warehouse w ON w.id = m.warehouse_id
       WHERE m.company_id = ${a.companyId} AND m.doc_date < ${start} ${p.range('item', sql`i.code`)} ${p.range('warehouse', sql`w.code`)} GROUP BY ${key}`.execute(db)).rows;
    const mv = (await sql<{ item_id: string; warehouse_id: string; item_code: string; item_name: string; wh: string; doc_date: string; doc_no: string; doc_class: string; header_id: string; qty: string; value: string }>`
      SELECT m.item_id, m.warehouse_id, i.code AS item_code, i.name_th AS item_name, w.code AS wh, m.doc_date, m.doc_no, m.doc_class, m.header_id, m.qty, m.value
        FROM v_stock_move m JOIN md_item i ON i.id = m.item_id JOIN md_warehouse w ON w.id = m.warehouse_id
       WHERE m.company_id = ${a.companyId} AND m.doc_date BETWEEN ${start} AND ${end} ${p.range('item', sql`i.code`)} ${p.range('warehouse', sql`w.code`)}
       ORDER BY i.code, ${byWh ? sql`w.code,` : sql``} m.doc_date, CASE WHEN m.qty > 0 THEN 0 ELSE 1 END, m.doc_no, m.line_no LIMIT 60001`.execute(db)).rows;
    const truncated = mv.length > 60000; if (truncated) mv.pop();
    const k = (i: string, w: string | null) => (byWh ? `${i}|${w}` : i);
    const op = new Map(opening.map((o) => [k(o.item_id, o.warehouse_id), o]));
    const groups = new Map<string, typeof mv>();
    for (const x of mv) { const g = k(x.item_id, x.warehouse_id); groups.set(g, [...(groups.get(g) ?? []), x]); }
    const rows: ReportRow[] = [];
    let tIn = d(0), tOut = d(0), tVal = d(0);
    for (const [g, list] of groups) {
      const o = op.get(g);
      let q = d(o?.qty ?? 0), v = d(o?.value ?? 0);
      rows.push({ t: 'group', c: { date: list[0]!.item_code, no: byWh ? list[0]!.wh : '', desc: list[0]!.item_name } });
      rows.push({ c: { desc: 'ยอดยกมา', bal: q.toString(), balv: money(v) }, muted: true });
      for (const x of list) {
        q = q.plus(d(x.qty)); v = v.plus(d(x.value));
        const isIn = d(x.qty).gt(0) || (d(x.qty).isZero() && d(x.value).gt(0));
        if (isIn) tIn = tIn.plus(d(x.value)); else tOut = tOut.plus(d(x.value).neg());
        rows.push({ c: { date: x.doc_date, no: x.doc_no, desc: byWh ? '' : x.wh, inq: d(x.qty).gt(0) ? x.qty : null, outq: d(x.qty).lt(0) ? d(x.qty).neg().toString() : null, val: x.value, bal: q.toString(), balv: money(v) },
          link: DOC_ROUTE[x.doc_class] ? `${DOC_ROUTE[x.doc_class]}/${x.header_id}` : null });
      }
      tVal = tVal.plus(v);
      rows.push({ t: 'sub', c: { desc: `คงเหลือ ${list[0]!.item_code}`, bal: q.toString(), balv: money(v) } });
    }
    rows.push({ t: 'total', c: { desc: `รวม ${groups.size} รายการ (มูลค่ารับ ${money(tIn)} จ่าย ${money(tOut)})`, balv: money(tVal) } });
    return { subtitle: p.describe({ date: 'วันที่', item: 'สินค้า', warehouse: 'คลัง' }) || 'ทั้งหมด', truncated, rows, columns: [{ key: 'date', label: 'วันที่', kind: 'date', width: 95 }, { key: 'no', label: 'เลขที่', kind: 'mono', width: 120 },
      { key: 'desc', label: byWh ? 'รายการ' : 'คลัง/รายการ' }, { key: 'inq', label: 'รับ', kind: 'qty', width: 100 }, { key: 'outq', label: 'จ่าย', kind: 'qty', width: 100 }, { key: 'val', label: 'มูลค่า', kind: 'money', width: 120 },
      { key: 'bal', label: 'คงเหลือ', kind: 'qty', width: 110 }, { key: 'balv', label: 'มูลค่าคงเหลือ', kind: 'money', width: 130 }] as ReportColumn[] };
  });

  // 4.2.1 / 4.2.7 สินค้าคงเหลือ ณ วันที่ (รวม / แยกคลัง)
  for (const [code, byWh] of [['4.2.1', false], ['4.2.7', true]] as const) defineReport(code, async (db, a, p) => {
    const asOf = p.asOf();
    const rows = (await sql<{ item_code: string; item_name: string; unit: string | null; wh: string | null; qty: string; value: string }>`
      SELECT i.code AS item_code, i.name_th AS item_name, u.code AS unit, ${byWh ? sql`w.code` : sql`NULL`} AS wh, sum(m.qty) AS qty, sum(m.value) AS value
        FROM v_stock_move m JOIN md_item i ON i.id = m.item_id JOIN md_warehouse w ON w.id = m.warehouse_id LEFT JOIN md_unit u ON u.id = i.base_unit_id
       WHERE m.company_id = ${a.companyId} AND m.doc_date <= ${asOf} ${p.range('item', sql`i.code`)} ${p.range('warehouse', sql`w.code`)}
       GROUP BY i.code, i.name_th, u.code ${byWh ? sql`, w.code` : sql``} ${p.bool('zero') ? sql`` : sql`HAVING abs(sum(m.qty)) > 0.00001 OR abs(sum(m.value)) > 0.004`}
       ORDER BY i.code ${byWh ? sql`, w.code` : sql``} LIMIT 50000`.execute(db)).rows;
    let tq = d(0), tv = d(0);
    const out: ReportRow[] = rows.map((r) => { tq = tq.plus(d(r.qty)); tv = tv.plus(d(r.value)); return { c: { code: r.item_code, name: r.item_name, wh: r.wh, qty: r.qty, unit: r.unit, avg: d(r.qty).isZero() ? null : d(r.value).div(d(r.qty)).toFixed(4), value: r.value } }; });
    out.push({ t: 'total', c: { name: `รวม ${rows.length} รายการ`, qty: tq.toString(), value: money(tv) } });
    return { subtitle: `ณ วันที่ ${p.fd(asOf)}`, rows: out, columns: [{ key: 'code', label: 'รหัสสินค้า', kind: 'mono', width: 150 }, { key: 'name', label: 'ชื่อสินค้า' }, ...(byWh ? [{ key: 'wh', label: 'คลัง', width: 60 }] : []),
      { key: 'qty', label: 'คงเหลือ', kind: 'qty', width: 110 }, { key: 'unit', label: 'หน่วย', width: 60 }, { key: 'avg', label: 'ต้นทุน/หน่วย', kind: 'money', width: 110 }, { key: 'value', label: 'มูลค่า', kind: 'money', width: 130 }] as ReportColumn[] };
  });

  // 4.3 สินค้าต่ำกว่าจุดสั่งซื้อ (ช่วงเวลาที่ใช้ = MMDD ล่าสุดที่ไม่เกินวันที่)
  defineReport('4.3', async (db, a, p) => {
    const asOf = p.asOf(), mmdd = asOf.slice(5, 7) + asOf.slice(8, 10);
    const rows = (await sql<{ item_code: string; item_name: string; wh: string; min_qty: string; max_qty: string | null; order_qty: string | null; qty: string }>`
      SELECT i.code AS item_code, i.name_th AS item_name, w.code AS wh, r.min_qty, r.max_qty, r.order_qty,
             coalesce((SELECT sum(m.qty) FROM v_stock_move m WHERE m.company_id = r.company_id AND m.item_id = r.item_id AND m.warehouse_id = r.warehouse_id AND m.doc_date <= ${asOf}), 0) AS qty
        FROM md_item_reorder r JOIN md_item i ON i.id = r.item_id JOIN md_warehouse w ON w.id = r.warehouse_id
       WHERE r.company_id = ${a.companyId} AND r.deleted_at IS NULL AND r.min_qty IS NOT NULL ${p.range('item', sql`i.code`)} ${p.range('warehouse', sql`w.code`)}
         AND r.start_mmdd = coalesce((SELECT max(x.start_mmdd) FROM md_item_reorder x WHERE x.item_id = r.item_id AND x.warehouse_id = r.warehouse_id AND x.deleted_at IS NULL AND x.start_mmdd <= ${mmdd}),
                                     (SELECT max(x.start_mmdd) FROM md_item_reorder x WHERE x.item_id = r.item_id AND x.warehouse_id = r.warehouse_id AND x.deleted_at IS NULL))
       ORDER BY i.code, w.code`.execute(db)).rows.filter((r) => d(r.qty).lt(d(r.min_qty)));
    return { subtitle: `ณ วันที่ ${p.fd(asOf)}`, rows: [...rows.map((r) => ({ c: { code: r.item_code, name: r.item_name, wh: r.wh, qty: r.qty, min: r.min_qty, max: r.max_qty, order: r.order_qty,
      suggest: r.max_qty ? d(r.max_qty).minus(d(r.qty)).toString() : r.order_qty } })), { t: 'total' as const, c: { name: `รวม ${rows.length} รายการ` } }],
      columns: [{ key: 'code', label: 'รหัสสินค้า', kind: 'mono', width: 150 }, { key: 'name', label: 'ชื่อสินค้า' }, { key: 'wh', label: 'คลัง', width: 60 }, { key: 'qty', label: 'คงเหลือ', kind: 'qty', width: 100 },
        { key: 'min', label: 'จุดสั่งซื้อ', kind: 'qty', width: 100 }, { key: 'max', label: 'สูงสุด', kind: 'qty', width: 100 }, { key: 'order', label: 'ซื้อครั้งละ', kind: 'qty', width: 100 }, { key: 'suggest', label: 'ควรสั่ง', kind: 'qty', width: 100 }] as ReportColumn[] };
  });

  // 4.4 ใบเบิก/โอน/ปรับปรุงสินค้า (OU RL JU CA)
  defineReport('4.4', async (db, a, p) => {
    const hs = (await sql<{ id: string; doc_class: string; doc_no: string; doc_date: string; remark: string | null; net_amount: string; doc_status: string }>`SELECT h.id, h.doc_class, h.doc_no, h.doc_date, h.remark, h.net_amount, h.doc_status FROM doc_header h
      WHERE h.company_id = ${a.companyId} AND h.doc_class IN ('OU', 'RL', 'JU', 'CA') AND h.deleted_at IS NULL ${p.bool('cancelled') ? sql`` : sql`AND h.doc_status <> 'C'`} ${p.dateRange('date', sql`h.doc_date`)}
      ORDER BY h.doc_class, h.doc_date, h.doc_no LIMIT 10000`.execute(db)).rows;
    const ls = hs.length && p.bool('detail') ? (await sql<{ header_id: string; item_code: string | null; description: string | null; wh: string | null; base_qty: string; stock_effect: number; cost_amount: string | null }>`
      SELECT l.header_id, i.code AS item_code, l.description, w.code AS wh, l.base_qty, l.stock_effect, l.cost_amount FROM doc_line l LEFT JOIN md_item i ON i.id = l.item_id LEFT JOIN md_warehouse w ON w.id = l.warehouse_id
       WHERE l.header_id IN (${sql.join(hs.map((h) => h.id))}) AND l.deleted_at IS NULL ORDER BY l.header_id, l.line_no`.execute(db)).rows : [];
    const rows: ReportRow[] = [];
    let cls: string | null = null, tot = d(0);
    for (const h of hs) {
      if (h.doc_class !== cls) { cls = h.doc_class; rows.push({ t: 'group', c: { no: cls, desc: STOCK_KINDS.find((k) => k.cls === cls)?.label ?? cls } }); }
      if (h.doc_status !== 'C') tot = tot.plus(d(h.net_amount));
      rows.push({ c: { no: h.doc_no, date: h.doc_date, desc: h.remark, value: h.net_amount }, link: DOC_ROUTE[h.doc_class] ? `${DOC_ROUTE[h.doc_class]}/${h.id}` : null, muted: h.doc_status === 'C' });
      for (const l of ls.filter((x) => x.header_id === h.id)) rows.push({ t: 'detail', c: { date: l.wh, desc: `${l.item_code ?? ''} ${l.description ?? ''}`, qty: d(l.base_qty).times(l.stock_effect || 1).toString(), value: l.cost_amount } });
    }
    rows.push({ t: 'total', c: { desc: `รวม ${hs.length} ใบ`, value: money(tot) } });
    return { subtitle: p.describe({ date: 'วันที่' }) || 'ทั้งหมด', rows, columns: [{ key: 'no', label: 'เลขที่', kind: 'mono', width: 130 }, { key: 'date', label: 'วันที่/คลัง', kind: 'date', width: 95 }, { key: 'desc', label: 'รายละเอียด' },
      { key: 'qty', label: 'จำนวน', kind: 'qty', width: 100 }, { key: 'value', label: 'มูลค่าต้นทุน', kind: 'money', width: 130 }] as ReportColumn[] };
  });

  // 4.5 รายละเอียดสินค้า
  defineReport('4.5', async (db, a, p) => {
    const rows = (await sql<Record<string, string | null>>`SELECT i.code, i.name_th, i.item_type, i.category_code, u.code AS unit, g.code AS grp, g.cost_method, i.std_cost, i.price_1, i.barcode, i.status
        FROM md_item i LEFT JOIN md_unit u ON u.id = i.base_unit_id LEFT JOIN md_item_account_group g ON g.id = i.account_group_id
       WHERE i.company_id = ${a.companyId} AND i.deleted_at IS NULL ${p.range('item', sql`i.code`)} ORDER BY i.code LIMIT 50000`.execute(db)).rows;
    const TYPE: Record<string, string> = { '0': 'สินค้า', '1': 'ชุด', '2': 'ชุดพิเศษ', '3': 'บริการ', '4': 'รายได้อื่น', '5': 'ค่าใช้จ่ายอื่น' };
    return { subtitle: `${rows.length.toLocaleString()} รายการ`, rows: [...rows.map((r): ReportRow => ({ c: { ...r, item_type: TYPE[r.item_type ?? ''] ?? r.item_type ?? null, cost_method: r.cost_method === 'F' ? 'FIFO' : 'เฉลี่ย', status: r.status === 'A' ? '' : 'เลิกใช้' }, muted: r.status !== 'A' })),
      { t: 'total' as const, c: { name_th: `รวม ${rows.length} รายการ` } }],
      columns: [{ key: 'code', label: 'รหัสสินค้า', kind: 'mono', width: 150 }, { key: 'name_th', label: 'ชื่อสินค้า' }, { key: 'item_type', label: 'ชนิด', width: 80 }, { key: 'category_code', label: 'หมวด', width: 60 },
        { key: 'unit', label: 'หน่วย', width: 60 }, { key: 'grp', label: 'กลุ่มบัญชี', width: 80 }, { key: 'cost_method', label: 'ต้นทุน', width: 60 }, { key: 'std_cost', label: 'ราคาทุน', kind: 'money', width: 100 },
        { key: 'price_1', label: 'ราคาขาย 1', kind: 'money', width: 100 }, { key: 'barcode', label: 'บาร์โค้ด', kind: 'mono', width: 120 }, { key: 'status', label: 'สถานะ', width: 60 }] as ReportColumn[] };
  });
}
