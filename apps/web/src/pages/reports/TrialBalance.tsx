import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { d, fmt, formatDate } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { PeriodRange } from '../../components/PeriodPicker';
import { cx, ErrorBox, KeyHints, Money, PageHead, useHotkeys } from '../../ui';
import { ExcelButton } from '../../components/ExcelExport';
import { AccountScope, BranchSelect, DeptSelect, scopeText, useBranches, useDepartments, type AccountScopeValue } from '../../components/ReportFilters';

interface Row { id: string; account_no: string; name_th: string; level: number; is_control: boolean; opening: string; debit: string; credit: string; closing: string }
interface TB { rows: Row[]; totals: Record<string, string>; balanced: boolean; fiscal_year: { code: string } | null }
const dr = (v: string) => (d(v).gt(0) ? v : '');   // ศูนย์ไม่แสดง (isPositive() นับ 0 เป็นบวก)
const cr = (v: string) => (d(v).lt(0) ? d(v).neg().toFixed(2) : '');

/** งบทดลอง (รายงาน 5.6.1 งบทดลองแบบเต็ม) — คลิกบัญชีเพื่อดูแยกประเภท */
type Cond = { from: string; to: string; level: number; dept: string; branch: string; scope: AccountScopeValue; zero: boolean };
/** งบทดลอง (รายงาน 5.6.1 งบทดลองแบบเต็ม) — คลิกบัญชีเพื่อดูแยกประเภท · เงื่อนไขแบบเดียวกับแยกประเภท + ปุ่ม แสดงรายงาน (เจ้าของ 17/11/2569) */
export function TrialBalancePage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState<Cond>({ from: sp.get('from') ?? '', to: sp.get('to') ?? '', level: Number(sp.get('level') ?? 0), dept: '', branch: me?.branch?.id ?? '',
    scope: { mode: 'all', from: '', to: '', one: null }, zero: false });
  const [A, setA] = useState<Cond | null>(() => (f.from && f.to ? f : null));   // ลิงก์ที่มีช่วงวันที่ = แสดงทันที
  const set = (p: Partial<Cond>) => setF((x) => ({ ...x, ...p }));
  // เปิดหน้าครั้งแรก: แสดงงบทดลองของงวดเริ่มต้นทันที · เปลี่ยนเงื่อนไขแล้วกด แสดงรายงาน
  const onRange = useCallback((v: { from: string; to: string }) => setF((x) => { const n = { ...x, ...v }; setA((a) => a ?? n); return n; }), []);
  const run = () => { if (!f.from) return; setA(f); setSp({ from: f.from, to: f.to }, { replace: true }); };
  useHotkeys({ F5: run }, [f]);
  const range = { from: A?.from ?? f.from, to: A?.to ?? f.to };
  const level = A?.level ?? 0;
  const ranged = A?.scope.mode === 'range';
  const q = useQuery({ enabled: !!A, queryKey: ['tb', A], queryFn: () => api.get<TB>('/api/v1/reports/trial-balance', { from: A!.from, to: A!.to, level: A!.level, department_id: A!.dept || undefined, branch_id: A!.branch || undefined,
    account_from: ranged ? A!.scope.from || undefined : undefined, account_to: ranged ? A!.scope.to || undefined : undefined, zero: A!.zero ? '1' : '0' }) });
  const ys = me?.company?.year_system ?? 'B';
  const t = q.data?.totals;
  const branches = useBranches(), depts = useDepartments();
  const cond = useMemo(() => A && [`ตั้งแต่ ${formatDate(A.from, ys)} ถึง ${formatDate(A.to, ys)}`, scopeText(A.scope, () => ''),
    A.branch ? `สาขา ${branches.data?.find((b) => b.id === A.branch)?.name ?? ''}` : 'ทุกสาขา', A.dept === 'none' ? 'ไม่ระบุแผนก' : A.dept ? `แผนก ${depts.data?.find((x) => x.id === A.dept)?.name_th ?? ''}` : 'ทุกแผนก'].join(' · '), [A, branches.data, depts.data, ys]);
  const changed = !!A && JSON.stringify(A) !== JSON.stringify(f);
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › งบทดลอง" title="งบทดลอง" lead={cond ?? undefined}
        actions={<>
          <button className="primary" disabled={!f.from || q.isFetching} onClick={run} title="แสดงรายงานตามเงื่อนไข (F5)">แสดงรายงาน <kbd>F5</kbd></button>
          <button disabled={!q.data} onClick={() => window.print()}>🖨 พิมพ์</button>
          <ExcelButton disabled={!q.data} />
        </>} />
      <div className="filters no-print">
        <AccountScope value={f.scope} onChange={(scope) => set({ scope })} allowOne={false} />
        <PeriodRange value={{ from: f.from, to: f.to }} onChange={onRange} />
        <label className="inline">แสดง <select value={f.level} onChange={(e) => set({ level: Number(e.target.value) })}><option value={0}>บัญชีย่อยทั้งหมด</option>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>ถึงระดับ {l}</option>)}</select></label>
        <BranchSelect value={f.branch} onChange={(branch) => set({ branch })} />
        <DeptSelect value={f.dept} onChange={(dept) => set({ dept })} />
        <label className="check"><input type="checkbox" checked={f.zero} onChange={(e) => set({ zero: e.target.checked })} /> แสดงบัญชีที่ไม่มียอด</label>
        {q.data && !ranged && <span className={cx('pill', q.data.balanced ? 'st-m' : 'st-c')}>{q.data.balanced ? 'ดุล ✓' : 'ไม่ดุล'}</span>}
        {q.data && ranged && <span className="pill" title="แสดงเฉพาะช่วงบัญชี — ยอดรวมไม่ต้องดุล">เฉพาะช่วงบัญชี</span>}
      </div>
      {changed && <p className="notebox no-print">เปลี่ยนเงื่อนไขแล้ว — กด แสดงรายงาน (F5) เพื่อแสดงตามเงื่อนไขใหม่</p>}
      <ErrorBox error={q.error} />
      <div className="print-head print-only"><b>{me?.company?.name_th}</b><br />งบทดลอง · {cond}</div>
      <div className="table-wrap tall">
        <table className="grid report">
          <thead>
            <tr><th rowSpan={2}>เลขที่บัญชี</th><th rowSpan={2}>ชื่อบัญชี</th><th colSpan={2} className="c">ยอดยกมา</th><th colSpan={2} className="c">ระหว่างงวด</th><th colSpan={2} className="c">ยอดคงเหลือ</th></tr>
            <tr><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">เดบิต</th><th className="r">เครดิต</th></tr>
          </thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.is_control && 'ctl')} onClick={() => nav(`/reports/ledger?account_id=${r.id}&from=${range.from}&to=${range.to}${A?.branch ? `&branch=${A.branch}` : ''}${A?.dept ? `&dept=${A.dept}` : ''}`)}>
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
      <KeyHints keys={[['F5', 'แสดงรายงาน'], ['F4', 'ค้นหาเลขที่บัญชี'], ['คลิกบัญชี', 'ดูบัญชีแยกประเภท']]} />
    </div>
  );
}
