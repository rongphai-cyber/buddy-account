import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { d, fmt, formatDate } from '@buddy/core';
import { api, type Department } from '../../api';
import { useSession } from '../../session';
import { PeriodRange } from '../../components/PeriodPicker';
import { cx, downloadCsv, ErrorBox, Money, PageHead } from '../../ui';

interface Row { id: string; account_no: string; name_th: string; level: number; is_control: boolean; opening: string; debit: string; credit: string; closing: string }
interface TB { rows: Row[]; totals: Record<string, string>; balanced: boolean; fiscal_year: { code: string } | null }
const dr = (v: string) => (d(v).isPositive() ? v : '');
const cr = (v: string) => (d(v).isNegative() ? d(v).neg().toFixed(2) : '');

/** งบทดลอง (รายงาน 5.6.1 งบทดลองแบบเต็ม) — คลิกบัญชีเพื่อดูแยกประเภท */
export function TrialBalancePage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [range, setRange] = useState({ from: sp.get('from') ?? '', to: sp.get('to') ?? '' });
  const [level, setLevel] = useState(Number(sp.get('level') ?? 0));
  const [dept, setDept] = useState('');
  const onRange = useCallback((v: { from: string; to: string }) => { setRange(v); setSp({ from: v.from, to: v.to }, { replace: true }); }, [setSp]);
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const q = useQuery({ enabled: !!range.from, queryKey: ['tb', range, level, dept, me?.branch?.id], queryFn: () => api.get<TB>('/api/v1/reports/trial-balance', { ...range, level, department_id: dept || undefined, branch_id: me?.branch?.id }) });
  const ys = me?.company?.year_system ?? 'B';
  const t = q.data?.totals;
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › งบทดลอง" title="งบทดลอง" lead={range.from ? `ตั้งแต่ ${formatDate(range.from, ys)} ถึง ${formatDate(range.to, ys)}${me?.branch ? ` · สาขา ${me.branch.name}` : ''}` : undefined}
        actions={<>
          <button onClick={() => window.print()}>พิมพ์</button>
          <button disabled={!q.data} onClick={() => downloadCsv(`งบทดลอง_${range.from}_${range.to}`, ['เลขที่บัญชี', 'ชื่อบัญชี', 'ยกมาเดบิต', 'ยกมาเครดิต', 'เดบิต', 'เครดิต', 'คงเหลือเดบิต', 'คงเหลือเครดิต'], q.data!.rows.map((r) => [r.account_no, r.name_th, dr(r.opening), cr(r.opening), r.debit, r.credit, dr(r.closing), cr(r.closing)]))}>ส่งออก Excel</button>
        </>} />
      <div className="filters no-print">
        <PeriodRange value={range} onChange={onRange} />
        <label className="inline">แสดง <select value={level} onChange={(e) => setLevel(Number(e.target.value))}><option value={0}>บัญชีย่อยทั้งหมด</option>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>ถึงระดับ {l}</option>)}</select></label>
        <label className="inline">แผนก <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">ทุกแผนก</option>{depts.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></label>
        {q.data && <span className={cx('pill', q.data.balanced ? 'st-m' : 'st-c')}>{q.data.balanced ? 'ดุล ✓' : 'ไม่ดุล'}</span>}
      </div>
      <ErrorBox error={q.error} />
      <div className="print-head print-only"><b>{me?.company?.name_th}</b><br />งบทดลอง ตั้งแต่ {formatDate(range.from, ys)} ถึง {formatDate(range.to, ys)}</div>
      <div className="table-wrap tall">
        <table className="grid report">
          <thead>
            <tr><th rowSpan={2}>เลขที่บัญชี</th><th rowSpan={2}>ชื่อบัญชี</th><th colSpan={2} className="c">ยอดยกมา</th><th colSpan={2} className="c">ระหว่างงวด</th><th colSpan={2} className="c">ยอดคงเหลือ</th></tr>
            <tr><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">เดบิต</th><th className="r">เครดิต</th></tr>
          </thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.is_control && 'ctl')} onClick={() => nav(`/reports/ledger?account_id=${r.id}&from=${range.from}&to=${range.to}`)}>
                <td className="mono">{r.account_no}</td><td style={{ paddingLeft: 10 + (level ? (r.level - 1) * 14 : 0) }}>{r.name_th}</td>
                <td className="r"><Money v={dr(r.opening)} /></td><td className="r"><Money v={cr(r.opening)} /></td>
                <td className="r"><Money v={r.debit} blankZero /></td><td className="r"><Money v={r.credit} blankZero /></td>
                <td className="r"><Money v={dr(r.closing)} /></td><td className="r"><Money v={cr(r.closing)} /></td>
              </tr>
            ))}
            {q.isLoading && <tr><td colSpan={8} className="empty">กำลังคำนวณ…</td></tr>}
          </tbody>
          {t && <tfoot><tr><td colSpan={2}>รวม {q.data!.rows.length} บัญชี</td><td className="r">{fmt(t.opening_debit!)}</td><td className="r">{fmt(t.opening_credit!)}</td><td className="r">{fmt(t.debit!)}</td><td className="r">{fmt(t.credit!)}</td><td className="r">{fmt(t.closing_debit!)}</td><td className="r">{fmt(t.closing_credit!)}</td></tr></tfoot>}
        </table>
      </div>
      <p className="hint no-print">ยอดคำนวณสดจากใบสำคัญทุกใบ · กำไร (ขาดทุน) ของปีก่อนปิดเข้าบัญชีกำไรสะสมให้อัตโนมัติ — ไม่ต้อง "คำนวณยอดใหม่" แบบ Express</p>
    </div>
  );
}
