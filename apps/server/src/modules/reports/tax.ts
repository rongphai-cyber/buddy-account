import { sql } from 'kysely';
import { d, type Decimal, type ReportColumn, type ReportRow } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest } from '../../http.js';
import { defineReport, type Ctx, type P } from './index.js';
import { pp36Credit } from '../vat.js';

/**
 * รายงานภาษี (กลุ่ม 6 + คู่มือบทที่ 16 S-TX-05/08) — จากแฟ้มภาษีซื้อ/ขาย (tax_vat_entry) และแฟ้มภาษีหัก ณ ที่จ่าย (tax_wht_entry) ตามงวดภาษีที่ยื่น
 * รูปแบบรายงานตามแบบกรมสรรพากร: ลำดับ วันที่ เลขที่ใบกำกับ ชื่อ เลขประจำตัวผู้เสียภาษี สาขา มูลค่า ภาษี
 */
const money = (x: Decimal) => x.toFixed(2);
const periodOf = (p: P) => {
  const per = p.str('period') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) throw badRequest('งวดภาษีไม่ถูกต้อง — เลือกเดือน');
  return per;
};
const filing = (p: P) => { const f = p.str('filing') ?? 'normal'; return f === 'all' ? sql`` : sql`AND v.is_late = ${f === 'late'}`; };
const branch = (b: string | null) => (!b || /^0+$/.test(b) ? 'สำนักงานใหญ่' : `สาขาที่ ${b.padStart(5, '0')}`);
type V = { tax_invoice_date: string; tax_invoice_no: string; doc_no: string | null; doc_class: string | null; party_name: string | null; party_tax_id: string | null; party_tax_branch_no: string | null;
  base_amount: string; vat_amount: string; zero_rate_amount: string; exempt_amount: string; nonclaim_base: string; nonclaim_vat: string; header_id: string | null };
/** ภาษีซื้อของเดือน = แฟ้มภาษีซื้อของงวด + ภ.พ.36 ที่นำส่งของเดือนก่อน (ยื่นปกติ — doc_class 'PP36' แยกกลุ่มในรายงาน) */
async function vatRows(db: Db, a: Ctx, p: P, kind: 'P' | 'S', per: string) {
  const pp36 = kind === 'P' && (p.str('filing') ?? 'normal') !== 'late';
  return (await sql<V>`SELECT v.tax_invoice_date, v.tax_invoice_no, v.doc_no, CASE WHEN v.vat_kind = 'R' THEN 'PP36' ELSE h.doc_class END AS doc_class, v.party_name, v.party_tax_id, v.party_tax_branch_no, v.base_amount, v.vat_amount, v.zero_rate_amount, v.exempt_amount, v.nonclaim_base, v.nonclaim_vat, v.header_id
      FROM tax_vat_entry v JOIN gl_period gp ON gp.id = v.vat_period_id LEFT JOIN doc_header h ON h.id = v.header_id LEFT JOIN md_department dp ON dp.id = v.department_id
     WHERE v.company_id = ${a.companyId} AND v.deleted_at IS NULL AND v.doc_status <> 'C' ${p.dept(sql`dp.code`)}
       AND ((v.vat_kind = ${kind} AND to_char(gp.start_date, 'YYYY-MM') = ${per} ${filing(p)})
         ${pp36 ? sql`OR (v.vat_kind = 'R' AND to_char(gp.start_date, 'YYYY-MM') = to_char((${per + '-01'}::date - interval '1 month'), 'YYYY-MM'))` : sql``})
     ORDER BY v.tax_invoice_date, v.tax_invoice_no LIMIT 20000`.execute(db)).rows;
}
const BILL_P: Record<string, string> = { HP: 'ซื้อเงินสด', RR: 'ซื้อเงินเชื่อ', CP: 'ใบเพิ่มหนี้', DN: 'ใบลดหนี้/ส่งคืน', AE: 'จ่ายเงินมัดจำ', OE: 'ค่าใช้จ่ายอื่น', PS: 'จ่ายชำระหนี้ (ภาษีเกณฑ์เงินสด)',
  RE: 'ค่าบริการที่แพลตฟอร์มหัก (ใบเสร็จรับเงิน)', PP36: 'ภ.พ.36 ที่นำส่งเดือนก่อน' };
const BILL_S: Record<string, string> = { HS: 'ขายเงินสด', IV: 'ขายเงินเชื่อ', DR: 'ใบเพิ่มหนี้', CN: 'ใบลดหนี้/รับคืน', AI: 'รับเงินมัดจำ', OI: 'รายได้อื่น', RE: 'รับชำระหนี้ (ภาษีเกณฑ์เงินสด)' };

function vatReport(kind: 'P' | 'S') {
  return async (db: Db, a: Ctx, p: P) => {
    const per = periodOf(p);
    const variant = p.str('variant') ?? 'std';
    const all = variant === 'nil' ? [] : await vatRows(db, a, p, kind, per);
    const list = variant === 'zero' ? all.filter((x) => !d(x.zero_rate_amount).isZero()) : all;
    const sign = (x: V) => (x.doc_class === 'CN' || x.doc_class === 'DN' ? -1 : 1);
    const rows: ReportRow[] = [];
    const tot = { b: d(0), v: d(0), z: d(0), e: d(0), nb: d(0), nv: d(0) };
    const sec = (title: string | null, xs: V[]) => {
      if (title) rows.push({ t: 'group', c: { name: title } });
      const s = { b: d(0), v: d(0), z: d(0), e: d(0), nb: d(0), nv: d(0) };
      xs.forEach((x, i) => {
        const g = sign(x);
        const b = d(x.base_amount).times(g), v = d(x.vat_amount).times(g), z = d(x.zero_rate_amount).times(g), e = d(x.exempt_amount).times(g), nb = d(x.nonclaim_base).times(g), nv = d(x.nonclaim_vat).times(g);
        s.b = s.b.plus(b); s.v = s.v.plus(v); s.z = s.z.plus(z); s.e = s.e.plus(e); s.nb = s.nb.plus(nb); s.nv = s.nv.plus(nv);
        rows.push({ c: { seq: i + 1, date: x.tax_invoice_date, inv: x.tax_invoice_no, doc: x.doc_no, name: x.party_name, tax: x.party_tax_id, br: branch(x.party_tax_branch_no), base: money(b), vat: money(v),
          ...(kind === 'S' ? { zero: money(z), exempt: money(e) } : { nbase: money(nb), nvat: money(nv) }) } });
      });
      if (title) rows.push({ t: 'sub', c: { name: `รวม${title} (${xs.length} รายการ)`, base: money(s.b), vat: money(s.v), ...(kind === 'S' ? { zero: money(s.z), exempt: money(s.e) } : { nbase: money(s.nb), nvat: money(s.nv) }) } });
      for (const k of ['b', 'v', 'z', 'e', 'nb', 'nv'] as const) tot[k] = tot[k].plus(s[k]);
    };
    if (variant === 'bill') {
      const names = kind === 'P' ? BILL_P : BILL_S;
      const groups = new Map<string, V[]>();
      for (const x of list) { const k = names[x.doc_class ?? ''] ?? 'อื่น ๆ (ป้อนเอง/สมุดรายวัน)'; groups.set(k, [...(groups.get(k) ?? []), x]); }
      for (const [k, xs] of groups) sec(k, xs);
    } else if (variant === 'claim' && kind === 'P') {
      sec('ขอคืนได้', list.filter((x) => !d(x.vat_amount).isZero() || d(x.nonclaim_vat).isZero()));
      sec('ขอคืนไม่ได้', list.filter((x) => !d(x.nonclaim_vat).isZero()));
    } else sec(null, list);
    if (variant === 'nil' || !list.length) rows.push({ t: 'note', c: { name: 'ไม่มีรายการ' } });
    rows.push({ t: 'total', c: { name: 'รวมทั้งสิ้น', base: money(tot.b), vat: money(tot.v), ...(kind === 'S' ? { zero: money(tot.z), exempt: money(tot.e) } : { nbase: money(tot.nb), nvat: money(tot.nv) }) } });
    return { title: `${kind === 'P' ? 'รายงานภาษีซื้อ' : 'รายงานภาษีขาย'}${variant === 'zero' ? ' (อัตราศูนย์)' : ''}`, subtitle: `เดือนภาษี ${p.fd(`${per}-01`).slice(3)}${p.str('filing') === 'late' ? ' · ยื่นเพิ่มเติม' : ''}`, rows,
      columns: [{ key: 'seq', label: 'ลำดับ', kind: 'int', width: 50 }, { key: 'date', label: 'วัน เดือน ปี', kind: 'date', width: 90 }, { key: 'inv', label: 'เลขที่ใบกำกับภาษี', kind: 'mono', width: 130 },
        { key: 'doc', label: 'เลขที่เอกสาร', kind: 'mono', width: 120 }, { key: 'name', label: kind === 'P' ? 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ' : 'ชื่อผู้ซื้อสินค้า/ผู้รับบริการ' }, { key: 'tax', label: 'เลขประจำตัวผู้เสียภาษี', kind: 'mono', width: 125 },
        { key: 'br', label: 'สถานประกอบการ', width: 100 }, { key: 'base', label: kind === 'S' ? 'มูลค่าที่เสียภาษี (อัตรา 7%)' : 'มูลค่าสินค้า/บริการ', kind: 'money', width: 125 }, { key: 'vat', label: 'จำนวนเงินภาษี', kind: 'money', width: 110 },
        ...(kind === 'S' ? [{ key: 'zero', label: 'มูลค่าอัตรา 0%', kind: 'money' as const, width: 110 }, { key: 'exempt', label: 'มูลค่ายกเว้น VAT', kind: 'money' as const, width: 115 }] : [{ key: 'nbase', label: 'มูลค่า (ขอคืนไม่ได้)', kind: 'money' as const, width: 115 }, { key: 'nvat', label: 'ภาษี (ขอคืนไม่ได้)', kind: 'money' as const, width: 105 }])] as ReportColumn[] };
  };
}

/** ยอดรวมภาษีของงวด (ใบลดหนี้ติดลบ) */
async function vatTotals(db: Db, a: Ctx, fil: ReturnType<typeof filing>, per: string, late = false) {
  const r = (await sql<{ kind: string; base: string; vat: string; zero: string; exempt: string; nbase: string; nvat: string; n: number }>`SELECT v.vat_kind AS kind,
        coalesce(sum(CASE WHEN h.doc_class IN ('CN', 'DN') THEN -v.base_amount ELSE v.base_amount END), 0) AS base, coalesce(sum(CASE WHEN h.doc_class IN ('CN', 'DN') THEN -v.vat_amount ELSE v.vat_amount END), 0) AS vat,
        coalesce(sum(CASE WHEN h.doc_class IN ('CN', 'DN') THEN -v.zero_rate_amount ELSE v.zero_rate_amount END), 0) AS zero,
        coalesce(sum(CASE WHEN h.doc_class IN ('CN', 'DN') THEN -v.exempt_amount ELSE v.exempt_amount END), 0) AS exempt, coalesce(sum(v.nonclaim_base), 0) AS nbase, coalesce(sum(v.nonclaim_vat), 0) AS nvat, count(*)::int AS n
      FROM tax_vat_entry v JOIN gl_period gp ON gp.id = v.vat_period_id LEFT JOIN doc_header h ON h.id = v.header_id
     WHERE v.company_id = ${a.companyId} AND v.deleted_at IS NULL AND v.doc_status <> 'C' AND to_char(gp.start_date, 'YYYY-MM') = ${per} ${fil} GROUP BY v.vat_kind`.execute(db)).rows;
  const z = { base: d(0), vat: d(0), zero: d(0), exempt: d(0), nbase: d(0), nvat: d(0), n: 0 };
  const get = (k: string) => { const x = r.find((y) => y.kind === k); return x ? { base: d(x.base), vat: d(x.vat), zero: d(x.zero), exempt: d(x.exempt), nbase: d(x.nbase), nvat: d(x.nvat), n: x.n } : z; };
  // ภ.พ.36 ที่นำส่งเดือนก่อนเป็นภาษีซื้อของเดือนนี้ (ยื่นปกติเท่านั้น)
  const pp36 = late ? { base: d(0), vat: d(0), n: 0 } : await pp36Credit(db, a.companyId, per);
  const P = get('P');
  return { P: { ...P, base: P.base.plus(pp36.base), vat: P.vat.plus(pp36.vat), n: P.n + pp36.n }, S: get('S'), pp36 };
}
/** ยอดขายที่ได้รับยกเว้น: เอกสารขายในเดือนที่ไม่มีภาษี (ประเภทราคา 0) และไม่อยู่ในแฟ้มภาษีขาย */
async function exemptSales(db: Db, a: Ctx, per: string) {
  return d((await sql<{ v: string }>`SELECT coalesce(sum(CASE WHEN h.doc_class = 'CN' THEN -h.amount_after_discount ELSE h.amount_after_discount END), 0) AS v FROM doc_header h
      WHERE h.company_id = ${a.companyId} AND h.module = 'AR' AND h.doc_class IN ('IV', 'HS', 'CN', 'DR') AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND NOT h.is_opening
        AND to_char(h.doc_date, 'YYYY-MM') = ${per} AND h.vat_amount = 0 AND NOT EXISTS (SELECT 1 FROM tax_vat_entry v WHERE v.header_id = h.id AND v.deleted_at IS NULL AND v.doc_status <> 'C')`.execute(db)).rows[0]!.v);
}

export function taxReports() {
  defineReport('6.2', vatReport('P'));
  defineReport('6.3', vatReport('S'));

  // 6.1 สรุปภาษีซื้อ/ขายของงวด
  defineReport('6.1', async (db, a, p) => {
    const per = periodOf(p);
    const t = await vatTotals(db, a, filing(p), per, p.str('filing') === 'late');
    const rows: ReportRow[] = [
      { t: 'group', c: { item: 'ภาษีขาย' } },
      { c: { item: 'มูลค่าขายที่ต้องเสียภาษี', base: money(t.S.base), vat: money(t.S.vat), n: t.S.n } },
      { c: { item: 'มูลค่าขายอัตราศูนย์', base: money(t.S.zero) } },
      { c: { item: 'มูลค่าขายที่ได้รับยกเว้น', base: money(t.S.exempt.plus(await exemptSales(db, a, per))) } },
      { t: 'group', c: { item: 'ภาษีซื้อ' } },
      { c: { item: 'ขอคืนได้', base: money(t.P.base), vat: money(t.P.vat), n: t.P.n } },
      ...(t.pp36.n ? [{ c: { item: '  (รวม ภ.พ.36 ที่นำส่งเดือนก่อน)', base: money(t.pp36.base), vat: money(t.pp36.vat), n: t.pp36.n } }] : []),
      { c: { item: 'ขอคืนไม่ได้ (ไม่นำมาหัก)', base: money(t.P.nbase), vat: money(t.P.nvat) } },
      { t: 'total', c: { item: t.S.vat.gte(t.P.vat) ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ชำระเกิน', vat: money(t.S.vat.minus(t.P.vat).abs()) } },
    ];
    return { subtitle: `เดือนภาษี ${p.fd(`${per}-01`).slice(3)}`, rows, columns: [{ key: 'item', label: 'รายการ' }, { key: 'n', label: 'จำนวนรายการ', kind: 'int', width: 100 }, { key: 'base', label: 'มูลค่า', kind: 'money', width: 150 }, { key: 'vat', label: 'ภาษี', kind: 'money', width: 140 }] as ReportColumn[] };
  });

  // 6.4 แบบ ภ.พ.30 — ข้อ 1–12 (ภาษีชำระเกินยกมา = ผลลัพธ์งวดก่อนที่ชำระเกิน ถ้าเลือกคำนวณ)
  defineReport('6.4', async (db, a, p) => {
    const per = periodOf(p);
    const t = await vatTotals(db, a, filing(p), per, p.str('filing') === 'late');
    // ยกเว้น = บิลที่ไม่มี VAT ทั้งใบ + รายการยกเว้นในบิลที่มี VAT (รหัส VAT 0)
    const exempt = (await exemptSales(db, a, per)).plus(t.S.exempt);
    let carry = d(0);
    if ((p.str('carry') ?? 'auto') === 'auto') {
      // ไล่ย้อนจากงวดแรกที่มีข้อมูลถึงงวดก่อน: ชำระเกินยกไปเรื่อย ๆ จนกว่าจะมีภาษีต้องชำระ
      const months = (await sql<{ m: string }>`SELECT DISTINCT to_char(gp.start_date, 'YYYY-MM') AS m FROM tax_vat_entry v JOIN gl_period gp ON gp.id = v.vat_period_id
          WHERE v.company_id = ${a.companyId} AND v.deleted_at IS NULL AND v.doc_status <> 'C' AND v.is_late = false AND to_char(gp.start_date, 'YYYY-MM') < ${per} ORDER BY 1`.execute(db)).rows.map((x) => x.m);
      for (const m of months) { const x = await vatTotals(db, a, sql`AND v.is_late = false`, m); const net = x.S.vat.minus(x.P.vat).minus(carry); carry = net.lt(0) ? net.neg() : d(0); }
    }
    const salesTaxable = t.S.base, zero = t.S.zero;
    const L = [salesTaxable.plus(zero).plus(exempt), zero, exempt, salesTaxable, t.S.vat, t.P.base, t.P.vat];
    const diff = t.S.vat.minus(t.P.vat);
    const net = diff.minus(carry);
    const rows: ReportRow[] = [
      { c: { no: '1', item: 'ยอดขายในเดือนนี้', amount: money(L[0]!) } },
      { c: { no: '2', item: 'ลบ ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี)', amount: money(L[1]!) } },
      { c: { no: '3', item: 'ลบ ยอดขายที่ได้รับยกเว้น (ถ้ามี)', amount: money(L[2]!) } },
      { c: { no: '4', item: 'ยอดขายที่ต้องเสียภาษี (1. ลบ 2. และ 3.)', amount: money(L[3]!) } },
      { t: 'sub', c: { no: '5', item: 'ภาษีขายเดือนนี้', amount: money(L[4]!) } },
      { c: { no: '6', item: 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหักในการคำนวณภาษีเดือนนี้', amount: money(L[5]!) } },
      { t: 'sub', c: { no: '7', item: 'ภาษีซื้อเดือนนี้', amount: money(L[6]!) } },
      { c: { no: '8', item: 'ภาษีที่ต้องชำระเดือนนี้ (ถ้า 5. มากกว่า 7.)', amount: diff.gt(0) ? money(diff) : '' } },
      { c: { no: '9', item: 'ภาษีที่ชำระเกินเดือนนี้ (ถ้า 5. น้อยกว่า 7.)', amount: diff.lt(0) ? money(diff.neg()) : '' } },
      { c: { no: '10', item: 'ภาษีที่ชำระเกินยกมา', amount: money(carry) } },
      { t: 'total', c: { no: '11', item: 'ต้องชำระ (ถ้า 8. มากกว่า 10.)', amount: net.gt(0) ? money(net) : '' } },
      { t: 'total', c: { no: '12', item: 'ชำระเกิน (ถ้า 10. มากกว่า 8. หรือ 9. รวมกับ 10.)', amount: net.lt(0) ? money(net.neg()) : '' } },
      { t: 'note', c: { item: `จำนวนใบกำกับ: ภาษีขาย ${t.S.n} รายการ · ภาษีซื้อ ${t.P.n} รายการ${t.pp36.n ? ` (รวม ภ.พ.36 เดือนก่อน ${t.pp36.n} รายการ ภาษี ${money(t.pp36.vat)})` : ''} · ยื่นภายในวันที่ 15 ของเดือนถัดไป (ยื่นทางอินเทอร์เน็ตได้ถึงวันที่ 23)` } },
    ];
    return { subtitle: `เดือนภาษี ${p.fd(`${per}-01`).slice(3)}${p.str('filing') === 'late' ? ' · ยื่นเพิ่มเติม' : ''}`, rows,
      columns: [{ key: 'no', label: 'ข้อ', width: 50 }, { key: 'item', label: 'รายการ' }, { key: 'amount', label: 'จำนวนเงิน (บาท)', kind: 'money', width: 180 }] as ReportColumn[] };
  });

  // 6.7 แบบ ภ.พ.36 — VAT ที่นำส่งแทนผู้ให้บริการต่างประเทศ (ค่าคอมมิชชั่น Agoda Booking.com Airbnb ฯลฯ) ของเดือนที่จ่าย
  defineReport('6.7', async (db, a, p) => {
    const per = periodOf(p);
    const xs = (await sql<{ tax_invoice_date: string; tax_invoice_no: string; doc_no: string | null; party_name: string | null; description: string | null; base_amount: string; vat_amount: string; header_id: string | null }>`
      SELECT v.tax_invoice_date, v.tax_invoice_no, v.doc_no, v.party_name, v.description, v.base_amount, v.vat_amount, v.header_id
        FROM tax_vat_entry v JOIN gl_period gp ON gp.id = v.vat_period_id
       WHERE v.company_id = ${a.companyId} AND v.vat_kind = 'R' AND v.deleted_at IS NULL AND v.doc_status <> 'C' AND to_char(gp.start_date, 'YYYY-MM') = ${per}
       ORDER BY v.tax_invoice_date, v.doc_no`.execute(db)).rows;
    let tb = d(0), tv = d(0);
    const rows: ReportRow[] = xs.map((x, i) => { tb = tb.plus(d(x.base_amount)); tv = tv.plus(d(x.vat_amount)); return { c: { seq: i + 1, date: x.tax_invoice_date, doc: x.doc_no, inv: x.tax_invoice_no, name: x.party_name, desc: x.description, base: x.base_amount, vat: x.vat_amount } }; });
    if (!xs.length) rows.push({ t: 'note', c: { name: 'ไม่มีรายการ' } });
    rows.push({ t: 'total', c: { name: `รวม ${xs.length} รายการ`, base: money(tb), vat: money(tv) } });
    rows.push({ t: 'note', c: { name: 'ยื่นและชำระภายในวันที่ 7 ของเดือนถัดไป (ยื่นทางอินเทอร์เน็ตวันที่ 15) · บันทึกจ่าย: Dr ภาษีมูลค่าเพิ่มค้างจ่าย ภ.พ.36 / Cr เงินฝากธนาคาร · ภาษีนี้เป็นภาษีซื้อในแบบ ภ.พ.30 เดือนถัดไปให้อัตโนมัติ' } });
    return { title: 'แบบ ภ.พ.36', subtitle: `เดือนที่จ่ายค่าบริการ ${p.fd(`${per}-01`).slice(3)}`, rows,
      columns: [{ key: 'seq', label: 'ลำดับ', kind: 'int', width: 50 }, { key: 'date', label: 'วันที่จ่าย', kind: 'date', width: 90 }, { key: 'doc', label: 'เลขที่เอกสาร', kind: 'mono', width: 120 },
        { key: 'inv', label: 'เลขที่ใบแจ้งหนี้', kind: 'mono', width: 130 }, { key: 'name', label: 'ผู้ให้บริการ (ต่างประเทศ)' }, { key: 'desc', label: 'รายละเอียด' },
        { key: 'base', label: 'ค่าบริการที่จ่าย', kind: 'money', width: 130 }, { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม', kind: 'money', width: 120 }] as ReportColumn[] };
  });

  // 6.5 / 6.6 ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53
  for (const [code, form] of [['6.5', 'S03'], ['6.6', 'S53']] as const) defineReport(code, async (db, a, p) => {
    const per = periodOf(p);
    const f = p.str('filing') ?? 'normal';
    const rows = (await sql<{ payee_tax_id: string | null; payee_tax_branch_no: string | null; payee_name: string; payee_address: string | null; certificate_date: string; income_type: string; rate: string; paid_amount: string; tax_amount: string; condition: string; certificate_no: string }>`
      SELECT w.payee_tax_id, w.payee_tax_branch_no, w.payee_name, w.payee_address, w.certificate_date, w.income_type, w.rate, w.paid_amount, w.tax_amount, w.condition, w.certificate_no
        FROM tax_wht_entry w JOIN gl_period gp ON gp.id = w.tax_period_id
       WHERE w.company_id = ${a.companyId} AND w.deleted_at IS NULL AND w.doc_status <> 'C' AND w.form_type = ${form} AND to_char(gp.start_date, 'YYYY-MM') = ${per}
         ${f === 'all' ? sql`` : sql`AND w.is_late = ${f === 'late'}`} ORDER BY w.certificate_date, w.certificate_no`.execute(db)).rows;
    let tp = d(0), tt = d(0);
    const out: ReportRow[] = rows.map((r, i) => { tp = tp.plus(d(r.paid_amount)); tt = tt.plus(d(r.tax_amount)); return { c: { seq: i + 1, tax: r.payee_tax_id, br: r.payee_tax_branch_no ?? '00000', name: r.payee_name, addr: r.payee_address,
      date: r.certificate_date, type: r.income_type, rate: d(r.rate).toString(), paid: r.paid_amount, wht: r.tax_amount, cond: r.condition, cert: r.certificate_no } }; });
    out.push({ t: 'total', c: { name: `รวม ${rows.length} ราย`, paid: money(tp), wht: money(tt) } });
    out.push({ t: 'note', c: { name: 'เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว · ส่งออกไฟล์ยื่นทางอินเทอร์เน็ตได้ที่ แฟ้มภาษีหัก ณ ที่จ่าย' } });
    return { title: `ใบแนบ ภ.ง.ด.${form === 'S03' ? '3' : '53'}`, subtitle: `เดือนภาษี ${p.fd(`${per}-01`).slice(3)}${f === 'late' ? ' · ยื่นเพิ่มเติม' : ''}`, rows: out,
      columns: [{ key: 'seq', label: 'ลำดับ', kind: 'int', width: 45 }, { key: 'tax', label: 'เลขประจำตัวผู้เสียภาษี', kind: 'mono', width: 120 }, { key: 'br', label: 'สาขา', kind: 'mono', width: 55 },
        { key: 'name', label: 'ชื่อผู้มีเงินได้' }, { key: 'addr', label: 'ที่อยู่' }, { key: 'date', label: 'วันที่จ่าย', kind: 'date', width: 90 }, { key: 'type', label: 'ประเภทเงินได้', width: 140 },
        { key: 'rate', label: 'อัตรา %', kind: 'qty', width: 60 }, { key: 'paid', label: 'จำนวนเงินที่จ่าย', kind: 'money', width: 115 }, { key: 'wht', label: 'ภาษีที่หัก', kind: 'money', width: 100 }, { key: 'cond', label: 'เงื่อนไข', width: 55 }] as ReportColumn[] };
  });
}
