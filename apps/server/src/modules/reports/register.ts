import { sql } from 'kysely';
import { d, registerOf, REGISTER_GROUPS, registerModes, TRADE_KINDS, SETTLE_KINDS, CASH_KINDS, BILL_KINDS, type ReportRow, type ReportColumn } from '@buddy/core';
import { defineReport } from './index.js';

/**
 * ทะเบียนเอกสาร (รายงานกลุ่ม 1.1–1.9, 1.G, 2.1–2.9) — เรียงตามเลขที่/วันที่ แยกตามลูกค้า/ผู้จำหน่าย/พนักงานขาย/เขตการขาย และถึงกำหนดชำระ
 * คอลัมน์ตามแบบรายงาน 141/241 (คู่มือหน้า 336, 340) · รายละเอียด = บรรทัดสินค้า + ตัดมัดจำ / รายการตัดหนี้ (ใบเสร็จ/ใบจ่าย)
 * ไม่นับเอกสารระบบสินค้าที่สร้างจากบัตรสต๊อก (module IC) — Express พิมพ์จากแฟ้มลูกหนี้/เจ้าหนี้
 */
const ROUTE: Record<string, string> = Object.fromEntries([...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BILL_KINDS].map((k) => [k.cls, k.route]));
type H = { id: string; doc_no: string; doc_date: string; due_date: string | null; doc_class: string; doc_status: string; ref_no: string | null; your_ref: string | null; price_type: string | null; vat_basis: string | null;
  discount_amount: string; amount_after_discount: string; vat_amount: string; net_amount: string; party_code: string | null; party_name: string | null; slm_code: string | null; slm_name: string | null; area: string | null; outstanding: string | null };

export function registerReports() {
  const codes = Object.keys(REGISTER_GROUPS).flatMap((g) => registerModes(g).map((_, i) => `${g}.${'123456789ABCDEFGH'[i]}`));
  defineReport(codes, async (db, a, p, code) => {
    const r = registerOf(code)!;
    const { spec, mode } = r;
    const ar = spec.side === 'AR';
    const due = mode.startsWith('due');
    const party = ar ? sql`c.code` : sql`s.code`;
    const out = due ? sql`(SELECT o.outstanding FROM ${sql.table(ar ? 'v_ar_outstanding' : 'v_ap_outstanding')} o WHERE o.header_id = h.id)` : sql`NULL`;
    const order = mode === 'no' || mode === 'due_no' && ar ? sql`h.doc_no` : mode === 'date' || mode === 'due_no' ? sql`h.doc_date, h.doc_no`
      : mode === 'party' ? sql`${party}, h.doc_date, h.doc_no` : mode === 'salesperson' ? sql`sp.code NULLS FIRST, h.doc_date, h.doc_no`
        : mode === 'area_slm' ? sql`h.sales_area_code NULLS FIRST, sp.code NULLS FIRST, h.doc_no` : mode === 'area_party' ? sql`h.sales_area_code NULLS FIRST, ${party}, h.doc_no`
          : mode === 'due_party' ? sql`${party}, h.due_date, h.doc_no` : sql`sp.code NULLS FIRST, h.due_date, h.doc_no`;
    const rows = (await sql<H>`SELECT h.id, h.doc_no, h.doc_date, h.due_date, h.doc_class, h.doc_status, h.ref_no, h.your_ref, h.price_type, h.vat_basis, h.discount_amount, h.amount_after_discount, h.vat_amount, h.net_amount,
          ${party} AS party_code, coalesce(h.party_name, c.name, s.name) AS party_name, sp.code AS slm_code, sp.name AS slm_name, h.sales_area_code AS area, ${out} AS outstanding
        FROM doc_header h LEFT JOIN md_customer c ON c.id = h.customer_id LEFT JOIN md_supplier s ON s.id = h.supplier_id LEFT JOIN md_salesperson sp ON sp.id = h.salesperson_id LEFT JOIN md_department dp ON dp.id = h.department_id
       WHERE h.company_id = ${a.companyId} AND h.deleted_at IS NULL AND h.doc_class IN (${sql.join(spec.classes)}) AND h.module <> 'IC'
         ${p.bool('cancelled') && !due ? sql`` : sql`AND h.doc_status <> 'C'`} ${p.range('doc_no', sql`h.doc_no`)} ${p.dateRange('date', due ? sql`h.due_date` : sql`h.doc_date`)}
         ${p.range(ar ? 'customer' : 'supplier', party)} ${ar ? p.range('salesperson', sql`sp.code`) : sql``} ${p.range('area', sql`h.sales_area_code`)} ${p.dept(sql`dp.code`)}
       ORDER BY ${order} LIMIT 20001`.execute(db)).rows.filter((x) => !due || d(x.outstanding ?? 0).abs().gte('0.005'));
    const truncated = rows.length > 20000;
    if (truncated) rows.pop();
    const ids = rows.map((x) => x.id);
    const detail = p.bool('detail') && ids.length && ids.length <= 5000;
    const lines = detail ? (await sql<{ header_id: string; line_no: number; item_code: string | null; description: string | null; qty: string; unit_code: string | null; unit_price: string | null; discount_text: string | null; net_amount: string }>`
        SELECT l.header_id, l.line_no, i.code AS item_code, l.description, l.qty, u.code AS unit_code, l.unit_price, l.discount_text, l.net_amount FROM doc_line l LEFT JOIN md_item i ON i.id = l.item_id LEFT JOIN md_unit u ON u.id = l.unit_id
         WHERE l.header_id IN (${sql.join(ids)}) AND l.deleted_at IS NULL AND l.line_kind <> 'K' ORDER BY l.header_id, l.line_no`.execute(db)).rows : [];
    const setts = detail && spec.classes.some((c) => ['RE', 'PS', 'BS', 'BR'].includes(c)) ? (await sql<{ header_id: string; doc_no: string; amount: string }>`SELECT s.payment_header_id AS header_id, i.doc_no, s.amount FROM doc_settlement s JOIN doc_header i ON i.id = s.invoice_header_id
         WHERE s.payment_header_id IN (${sql.join(ids)}) AND s.deleted_at IS NULL ORDER BY i.doc_no`.execute(db)).rows : [];
    const deps = detail ? (await sql<{ header_id: string; doc_no: string; amount: string }>`SELECT k.to_header_id AS header_id, f.doc_no, k.amount FROM doc_link k JOIN doc_header f ON f.id = k.from_header_id
         WHERE k.to_header_id IN (${sql.join(ids)}) AND k.link_type = 'DEPOSIT' AND k.deleted_at IS NULL`.execute(db)).rows : [];
    const by = <T extends { header_id: string }>(xs: T[]) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(x.header_id, [...(m.get(x.header_id) ?? []), x]); return m; };
    const L = by(lines), S = by(setts), Dp = by(deps);
    const columns: ReportColumn[] = [
      { key: 'no', label: 'เลขที่', kind: 'mono', width: 120 }, { key: 'date', label: due ? 'ครบกำหนด' : 'วันที่', kind: 'date', width: 90 },
      ...(due ? [{ key: 'doc_date', label: 'วันที่', kind: 'date' as const, width: 90 }] : []),
      { key: 'party', label: ar ? 'ลูกค้า' : 'ผู้จำหน่าย' },
      ...(ar ? [{ key: 'slm', label: 'พนักงานขาย', width: 110 }] : [{ key: 'ref', label: 'เลขที่บิล', kind: 'mono' as const, width: 110 }]),
      { key: 'v', label: 'V', width: 30 }, { key: 'disc', label: 'ส่วนลด', kind: 'money', width: 100 }, { key: 'amount', label: 'มูลค่าสินค้า', kind: 'money', width: 120 },
      { key: 'vat', label: 'VAT.', kind: 'money', width: 100 }, { key: 'net', label: 'รวมทั้งสิ้น', kind: 'money', width: 120 },
      ...(due ? [{ key: 'out', label: 'ค้างชำระ', kind: 'money' as const, width: 120 }] : spec.due ? [{ key: 'due', label: 'ครบกำหนด', kind: 'date' as const, width: 90 }] : []),
    ];
    const sign = (x: H) => (x.doc_class === 'CN' || x.doc_class === 'DN' ? -1 : 1);
    const keyOf = (x: H) => mode === 'party' || mode === 'due_party' ? `${x.party_code ?? ''}|${x.party_name ?? ''}` : mode === 'salesperson' || mode === 'due_slm' ? `${x.slm_code ?? '(ไม่ระบุ)'}|${x.slm_name ?? ''}`
      : mode === 'area_slm' ? `${x.area ?? '(ไม่ระบุ)'} / ${x.slm_code ?? '-'}|${x.slm_name ?? ''}` : mode === 'area_party' ? `${x.area ?? '(ไม่ระบุ)'} / ${x.party_code ?? ''}|${x.party_name ?? ''}` : null;
    const out2: ReportRow[] = [];
    const zero = () => ({ n: 0, disc: d(0), amount: d(0), vat: d(0), net: d(0), out: d(0) });
    let g: ReturnType<typeof zero> | null = null, gKey: string | null = null;
    const tot = zero();
    const flush = () => { if (g && gKey !== null) out2.push({ t: 'sub', c: { party: `รวม ${gKey.split('|')[0]} (${g.n} ใบ)`, disc: g.disc.toFixed(2), amount: g.amount.toFixed(2), vat: g.vat.toFixed(2), net: g.net.toFixed(2), ...(due ? { out: g.out.toFixed(2) } : {}) } }); };
    for (const x of rows) {
      const k = keyOf(x);
      if (k !== null && k !== gKey) { flush(); gKey = k; g = zero(); const [code, name] = k.split('|'); out2.push({ t: 'group', c: { no: code ?? '', party: name ?? '' } }); }
      const cancelled = x.doc_status === 'C';
      const sg = sign(x);
      out2.push({ c: { no: x.doc_no, date: due ? x.due_date : x.doc_date, ...(due ? { doc_date: x.doc_date } : {}), party: `${x.party_code ? x.party_code + ' ' : ''}${x.party_name ?? ''}${cancelled ? ' [ยกเลิก]' : ''}`,
        slm: x.slm_code, ref: x.ref_no ?? x.your_ref, v: x.price_type === '0' ? 'N' : x.price_type === '1' ? 'I' : 'E', disc: d(x.discount_amount).times(sg).toFixed(2), amount: d(x.amount_after_discount).times(sg).toFixed(2),
        vat: d(x.vat_amount).times(sg).toFixed(2), net: d(x.net_amount).times(sg).toFixed(2), due: x.due_date, out: x.outstanding }, link: ROUTE[x.doc_class] ? `${ROUTE[x.doc_class]}/${x.id}` : null, muted: cancelled });
      if (!cancelled) for (const t of [tot, ...(g ? [g] : [])]) { t.n++; t.disc = t.disc.plus(d(x.discount_amount).times(sg)); t.amount = t.amount.plus(d(x.amount_after_discount).times(sg)); t.vat = t.vat.plus(d(x.vat_amount).times(sg)); t.net = t.net.plus(d(x.net_amount).times(sg)); t.out = t.out.plus(d(x.outstanding ?? 0)); }
      if (detail) {
        for (const l of L.get(x.id) ?? []) out2.push({ t: 'detail', c: { no: '', date: String(l.line_no), party: `${l.item_code ?? ''} ${l.description ?? ''}`.trim(), slm: `${d(l.qty).toString()} ${l.unit_code ?? ''}`, ref: `${d(l.qty).toString()} ${l.unit_code ?? ''}`, v: '', disc: l.discount_text, amount: l.unit_price, net: l.net_amount } });
        for (const s of S.get(x.id) ?? []) out2.push({ t: 'detail', c: { party: `ตัดหนี้ ${s.doc_no}`, net: s.amount } });
        for (const s of Dp.get(x.id) ?? []) out2.push({ t: 'detail', c: { party: `ตัดใบรับมัดจำ# ${s.doc_no}`, net: d(s.amount).neg().toFixed(2) } });
      }
    }
    flush();
    out2.push({ t: 'total', c: { party: `รวมทั้งสิ้น ${tot.n} ใบ`, disc: tot.disc.toFixed(2), amount: tot.amount.toFixed(2), vat: tot.vat.toFixed(2), net: tot.net.toFixed(2), ...(due ? { out: tot.out.toFixed(2) } : {}) } });
    const scope = p.describe({ date: due ? 'วันที่ครบกำหนด' : 'วันที่', doc_no: 'เลขที่', [ar ? 'customer' : 'supplier']: ar ? 'ลูกค้า' : 'ผู้จำหน่าย', salesperson: 'พนักงานขาย', area: 'เขตการขาย' });
    return { subtitle: scope || 'ทั้งหมด', columns, rows: out2, truncated: truncated || (p.bool('detail') && ids.length > 5000) };
  });
}
