import { sql } from 'kysely';
import { d, type ReportRow } from '@buddy/core';
import { ASSET_COLS, assetSchedule, fiscalYears, withProjectedYears, type AssetRow } from '../fa.js';
import { defineReport } from './index.js';

/** 5.B รายการทรัพย์สิน: ราคาทุน ค่าเสื่อมสะสมต้นงวด ค่าเสื่อมในช่วง ค่าเสื่อมสะสมปลายงวด มูลค่าตามบัญชี — งวดที่ลงบัญชีแล้วใช้ยอดจริง งวดที่ยังไม่ลงใช้ยอดคำนวณ */
export function faReports() {
  defineReport('5.B', async (db, a, p) => {
    const today = new Date().toISOString().slice(0, 10);
    const [f0, t0] = p.dates('date');
    const to = t0 ?? today;
    const fys = withProjectedYears(await fiscalYears(db, a.companyId), to);   // ปีที่ยังไม่กำหนดรอบบัญชี = ประมาณการ
    const from = f0 ?? (fys.find((y) => y.start <= to && to <= y.end)?.start ?? to.slice(0, 4) + '-01-01');
    const status = p.str('status') ?? 'all';
    const assets = (await sql<AssetRow & { name_th: string; group_code: string; purchase_date: string; status: string }>`SELECT ${ASSET_COLS}, a.name_th, g.code AS group_code, a.purchase_date::text AS purchase_date, a.status
        FROM fa_asset a JOIN md_asset_account_group g ON g.id = a.account_group_id
       WHERE a.company_id = ${a.companyId} AND a.deleted_at IS NULL AND a.purchase_date <= ${to} ${status !== 'all' ? sql`AND a.status = ${status}` : sql``} ORDER BY g.code, a.code`.execute(db)).rows;
    const posted = new Map<string, Map<string, string>>();
    for (const r of (await sql<{ asset_id: string; period_id: string; amount: string }>`SELECT asset_id, period_id, amount FROM fa_depreciation WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows) {
      if (!posted.has(r.asset_id)) posted.set(r.asset_id, new Map()); posted.get(r.asset_id)!.set(r.period_id, r.amount);
    }
    let until = fys.findIndex((y) => y.start <= to && to <= y.end); if (until < 0) until = fys.length - 1;
    const pend = new Map(fys.flatMap((y) => y.periods.map((x) => [x.id, x.end])));
    const rows: ReportRow[] = [];
    const sum = { cost: d(0), b: d(0), dep: d(0), e: d(0), nbv: d(0) };
    let grp = '';
    for (const x of assets) {
      if (x.group_code !== grp) { grp = x.group_code; rows.push({ t: 'group', c: { code: `กลุ่มบัญชี ${grp}` } }); }
      const s = assetSchedule(x, fys, posted.get(x.id) ?? new Map(), until);
      let before = d(x.accum_depr_bf), dep = d(0);
      for (const y of s.years) for (const m of y.months) { const e = pend.get(m.period_id)!; if (e < from) before = before.plus(m.amount); else if (e <= to) dep = dep.plus(m.amount); }
      const end = before.plus(dep), nbv = d(x.cost).minus(end);
      sum.cost = sum.cost.plus(x.cost); sum.b = sum.b.plus(before); sum.dep = sum.dep.plus(dep); sum.e = sum.e.plus(end); sum.nbv = sum.nbv.plus(nbv);
      rows.push({ c: { code: x.code, name: x.name_th, date: x.purchase_date, cost: d(x.cost).toFixed(2), method: x.is_depreciable && x.method !== '0' ? `${x.method === '2' ? 'ลดยอด' : 'เส้นตรง'} ${d(x.rate ?? 0).toString()}%` : 'ไม่คิด',
        before: before.toFixed(2), dep: dep.toFixed(2), end: end.toFixed(2), nbv: nbv.toFixed(2), sold: x.sold_date ?? '' }, link: `/fa/assets/${x.id}`, muted: x.status === 'S' });
    }
    rows.push({ t: 'total', c: { name: `รวม ${assets.length.toLocaleString()} รายการ`, cost: sum.cost.toFixed(2), before: sum.b.toFixed(2), dep: sum.dep.toFixed(2), end: sum.e.toFixed(2), nbv: sum.nbv.toFixed(2) } });
    return { subtitle: `ค่าเสื่อมงวด ${p.fd(from)} – ${p.fd(to)}`, rows, columns: [{ key: 'code', label: 'รหัส', kind: 'mono', width: 110 }, { key: 'name', label: 'ชื่อทรัพย์สิน' }, { key: 'date', label: 'วันที่ซื้อ', kind: 'date', width: 80 },
      { key: 'method', label: 'วิธี/อัตรา', width: 90 }, { key: 'cost', label: 'ราคาทุน', kind: 'money' }, { key: 'before', label: 'ค่าเสื่อมสะสมต้นงวด', kind: 'money' }, { key: 'dep', label: 'ค่าเสื่อมงวดนี้', kind: 'money' },
      { key: 'end', label: 'ค่าเสื่อมสะสมปลายงวด', kind: 'money' }, { key: 'nbv', label: 'มูลค่าตามบัญชี', kind: 'money' }, { key: 'sold', label: 'วันที่ขาย', kind: 'date', width: 80 }] };
  });
}
