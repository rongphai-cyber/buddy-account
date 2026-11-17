import { Fragment, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, formatDate } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { useAccounts } from '../../components/AccountCell';
import { PeriodRange } from '../../components/PeriodPicker';
import { DateText, Empty, ErrorBox, KeyHints, Money, PageHead, useHotkeys } from '../../ui';
import { DocLink } from '../../components/DocLink';
import { ExcelButton } from '../../components/ExcelExport';
import { AccountScope, BranchSelect, DeptSelect, scopeText, useBranches, useDepartments, type AccountScopeValue } from '../../components/ReportFilters';

type Row = { journal_id: string; voucher_no: string; voucher_date: string; description: string | null; journal_description: string | null; debit: string; credit: string; balance: string; account_no: string; department_code: string | null; source_doc_no: string | null; source_header_id: string | null; source_doc_class: string | null };
interface Section { account: { id: string; account_no: string; name_th: string; is_control: boolean }; opening: string; debit: string; credit: string; closing: string; rows: Row[] }
interface Report { sections: Section[]; debit: string; credit: string; truncated: boolean; account_count: number }
type Cond = { scope: AccountScopeValue; from: string; to: string; branch: string; dept: string; zero: boolean };

/**
 * บัญชีแยกประเภท (เจ้าของ 17/11/2569): ทุกบัญชี / ช่วงเลขที่บัญชี / บัญชีเดียว · สาขา · แผนก · แสดงบัญชีที่ไม่มียอด
 * ปุ่ม แสดงรายงาน (F5) · พิมพ์ · ส่งออก Excel — เปิดจากงบทดลอง/ผังบัญชี (account_id ใน URL) แสดงทันที · คลิกรายการเปิดใบสำคัญ
 */
export function LedgerPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const acc0 = sp.get('account_id');
  const [f, setF] = useState<Cond>({ scope: { mode: acc0 ? 'one' : (sp.get('acc_from') ? 'range' : 'all'), from: sp.get('acc_from') ?? '', to: sp.get('acc_to') ?? '', one: acc0 },
    from: sp.get('from') ?? '', to: sp.get('to') ?? '', branch: sp.get('branch') ?? me?.branch?.id ?? '', dept: sp.get('dept') ?? '', zero: false });
  const [applied, setApplied] = useState<Cond | null>(() => (acc0 && f.from && f.to ? f : null));   // เปิดจากงบทดลอง/ผังบัญชี = แสดงทันที
  const set = (p: Partial<Cond>) => setF((x) => ({ ...x, ...p }));
  // ช่วงงวดตั้งค่าเริ่มต้นเอง (ปีบัญชีปัจจุบัน) · เปิดจากงบทดลอง (มีบัญชี) = แสดงรายงานทันที
  const onRange = useCallback((v: { from: string; to: string }) => setF((x) => { const n = { ...x, ...v }; if (acc0 && !applied) setApplied(n); return n; }), [acc0, applied]);
  const ready = !!f.from && (f.scope.mode !== 'one' || !!f.scope.one) && (f.scope.mode !== 'range' || !!f.scope.from || !!f.scope.to);
  const run = () => {
    if (!ready) return;
    setApplied(f);
    setSp(Object.fromEntries(Object.entries({ from: f.from, to: f.to, account_id: f.scope.mode === 'one' ? f.scope.one : '', acc_from: f.scope.mode === 'range' ? f.scope.from : '', acc_to: f.scope.mode === 'range' ? f.scope.to : '', branch: f.branch, dept: f.dept }).filter(([, v]) => v)) as Record<string, string>, { replace: true });
  };
  useHotkeys({ F5: run }, [f]);
  const A = applied;
  const q = useQuery({
    enabled: !!A, queryKey: ['ledgers', A],
    queryFn: () => api.get<Report>('/api/v1/reports/ledgers', { from: A!.from, to: A!.to, account_id: A!.scope.mode === 'one' ? A!.scope.one : undefined,
      account_from: A!.scope.mode === 'range' ? A!.scope.from || undefined : undefined, account_to: A!.scope.mode === 'range' ? A!.scope.to || undefined : undefined,
      branch_id: A!.branch || undefined, department_id: A!.dept || undefined, zero: A!.zero ? '1' : '0' }),
  });
  const ys = me?.company?.year_system ?? 'B';
  const accts = useAccounts(), branches = useBranches(), depts = useDepartments();
  const R = q.data;
  const single = A?.scope.mode === 'one' && R?.sections.length === 1 ? R.sections[0]! : null;
  const ctlCol = !!R?.sections.some((s) => s.account.is_control);
  const ncol = ctlCol ? 8 : 7;
  const cond = useMemo(() => A && [
    `ตั้งแต่ ${formatDate(A.from, ys)} ถึง ${formatDate(A.to, ys)}`,
    scopeText(A.scope, (id) => { const a = accts.data?.find((x) => x.id === id); return a ? `${a.account_no} ${a.name_th}` : ''; }),
    A.branch ? `สาขา ${branches.data?.find((b) => b.id === A.branch)?.name ?? ''}` : 'ทุกสาขา',
    A.dept ? `แผนก ${depts.data?.find((x) => x.id === A.dept)?.name_th ?? ''}` : 'ทุกแผนก',
  ].join(' · '), [A, accts.data, branches.data, depts.data, ys]);
  const changed = !!A && JSON.stringify(A) !== JSON.stringify(f);
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › บัญชีแยกประเภท" title={single ? `บัญชีแยกประเภท ${single.account.account_no} ${single.account.name_th}` : 'บัญชีแยกประเภท'} lead={cond ?? undefined}
        actions={<>
          <button className="primary" disabled={!ready || q.isFetching} onClick={run} title="แสดงรายงานตามเงื่อนไข (F5)">แสดงรายงาน <kbd>F5</kbd></button>
          <button disabled={!R} onClick={() => window.print()}>🖨 พิมพ์</button>
          <ExcelButton disabled={!R} />
        </>} />
      <div className="filters no-print">
        <AccountScope value={f.scope} onChange={(scope) => set({ scope })} />
        <PeriodRange value={{ from: f.from, to: f.to }} onChange={onRange} />
        <BranchSelect value={f.branch} onChange={(branch) => set({ branch })} />
        <DeptSelect value={f.dept} onChange={(dept) => set({ dept })} />
        <label className="check"><input type="checkbox" checked={f.zero} onChange={(e) => set({ zero: e.target.checked })} /> แสดงบัญชีที่ไม่มียอด</label>
      </div>
      {changed && <p className="notebox no-print">เปลี่ยนเงื่อนไขแล้ว — กด แสดงรายงาน (F5) เพื่อแสดงตามเงื่อนไขใหม่</p>}
      <ErrorBox error={q.error} />
      <div className="print-head print-only"><b>{me?.company?.name_th}</b><br />บัญชีแยกประเภท · {cond}</div>
      {!A && <Empty title="เลือกเงื่อนไขแล้วกด แสดงรายงาน" text="เลือกบัญชี (ทุกบัญชี · ช่วงเลขที่บัญชี · บัญชีเดียว) งวด สาขา แผนก แล้วกด แสดงรายงาน หรือ F5" />}
      {A && q.isFetching && !R && <p className="hint">กำลังคำนวณ…</p>}
      {R?.truncated && <p className="bad small">รายการมากเกิน 50,000 บรรทัด แสดงบางส่วน — เลือกช่วงบัญชีหรือช่วงวันที่ให้แคบลง</p>}
      {R && (
        <div className="table-wrap tall">
          <table className="grid report ledger-report">
            <thead><tr><th>วันที่</th><th>เลขที่ใบสำคัญ</th>{ctlCol && <th>บัญชี</th>}<th>คำอธิบาย</th><th>แผนก</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">คงเหลือ</th></tr></thead>
            <tbody>
              {R.sections.map((s) => (
                <Fragment key={s.account.id}>
                  {!single && <tr className="acc-head total"><td colSpan={ncol}>{s.account.account_no} {s.account.name_th}</td></tr>}
                  <tr className="opening"><td colSpan={ncol - 3}>ยอดยกมา ณ {formatDate(A!.from, ys)}</td><td /><td /><td className="r"><Money v={s.opening} paren /></td></tr>
                  {s.rows.map((r, i) => (
                    <tr key={i} className="row-open" onClick={() => nav(`/gl/journals/${r.journal_id}`)}>
                      <td className="mono"><DateText v={r.voucher_date} /></td><td className="mono">{r.voucher_no}</td>{ctlCol && <td className="mono">{r.account_no}</td>}
                      <td>{r.description || r.journal_description}{r.source_doc_no && <span className="muted small"> · <DocLink id={r.source_header_id} no={r.source_doc_no} cls={r.source_doc_class} /></span>}</td><td className="mono small">{r.department_code}</td>
                      <td className="r"><Money v={r.debit} blankZero /></td><td className="r"><Money v={r.credit} blankZero /></td><td className="r"><Money v={r.balance} paren /></td>
                    </tr>
                  ))}
                  {!s.rows.length && <tr><td colSpan={ncol} className="empty">ไม่มีรายการในช่วงนี้</td></tr>}
                  <tr className="total"><td colSpan={ncol - 3}>รวม {s.rows.length} รายการ · คงเหลือยกไป</td><td className="r">{fmt(s.debit)}</td><td className="r">{fmt(s.credit)}</td><td className="r">{fmt(s.closing, { paren: true })}</td></tr>
                </Fragment>
              ))}
              {!R.sections.length && <tr><td colSpan={ncol} className="empty">ไม่มีบัญชีที่มียอดตามเงื่อนไขนี้</td></tr>}
            </tbody>
            {!single && R.sections.length > 1 && <tfoot><tr><td colSpan={ncol - 3}>รวมทั้งสิ้น {R.account_count.toLocaleString()} บัญชี</td><td className="r">{fmt(R.debit)}</td><td className="r">{fmt(R.credit)}</td><td /></tr></tfoot>}
          </table>
        </div>
      )}
      <KeyHints keys={[['F5', 'แสดงรายงาน'], ['F4', 'ค้นหาเลขที่บัญชี'], ['คลิกรายการ', 'เปิดใบสำคัญ']]} />
    </div>
  );
}
