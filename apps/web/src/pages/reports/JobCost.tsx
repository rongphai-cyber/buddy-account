import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate, todayIso } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { BranchSelect, useBranches } from '../../components/ReportFilters';
import { ExcelButton } from '../../components/ExcelExport';
import { cx, DateInput, DateText, Empty, ErrorBox, KeyHints, Money, PageHead, Pill, useHotkeys } from '../../ui';

interface SumRow { id: string; code: string; name_th: string; status: string; start_date: string | null; end_date: string | null; customer_code: string | null; customer_name: string | null; contract_amount: string | null;
  revenue: string; cost: string; profit: string; margin: string | null; budget: string; budget_left: string; budget_used: string | null; stock_for_job: string }
interface Summary { rows: SumRow[]; totals: { revenue: string; cost: string; profit: string; margin: string | null; budget: string; contract_amount: string; stock_for_job: string } }
interface Part { rows: Array<{ account_id: string; account_no: string; name_th: string; actual: string; budget: string | null; diff: string | null; used: string | null }>; actual: string; budget: string; diff: string; used: string | null }
interface Detail { job: { id: string; code: string; name_th: string; status: string; start_date: string | null; end_date: string | null; contract_amount: string | null; ref_no: string | null; manager: string | null; customer_code: string | null; customer_name: string | null };
  revenue: Part; cost: Part; other: Part; profit: string; margin: string | null }
type Cond = { mode: 'all' | 'range'; from: string; to: string; status: 'all' | 'A' | 'I'; branch: string };
const pct = (v: string | null) => (v === null ? '' : `${Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

/**
 * ต้นทุน/กำไรตาม Job (เจ้าของ 17/11/2569 · HANDOFF 129) — คำนวณสดจากบรรทัดใบสำคัญที่ระบุ Job
 * รายได้ = บัญชีหมวด 4 · ต้นทุน = หมวด 5 (รวมเบิกใช้ ต้นทุนขาย ค่าใช้จ่าย สมุดรายวัน) · ซื้อสินค้าเข้าคลังโดยใส่ Job แสดงแยก (เป็นต้นทุนเมื่อเบิก)
 * สรุปทุก Job → คลิก Job ดูรายบัญชีเทียบงบ → คลิกบัญชีดูแยกประเภทเฉพาะ Job นั้น
 */
export function JobCostPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const jobId = sp.get('id');
  const [f, setF] = useState<Cond>({ mode: sp.get('from') ? 'range' : 'all', from: sp.get('from') ?? '', to: sp.get('to') ?? '', status: (sp.get('status') as Cond['status']) ?? 'all', branch: sp.get('branch') ?? '' });
  const [A, setA] = useState<Cond>(f);
  const set = (p: Partial<Cond>) => setF((x) => ({ ...x, ...p }));
  const run = () => { setA(f); setSp(Object.fromEntries(Object.entries({ id: jobId ?? '', from: f.mode === 'range' ? f.from : '', to: f.mode === 'range' ? f.to : '', status: f.status === 'all' ? '' : f.status, branch: f.branch }).filter(([, v]) => v)) as Record<string, string>, { replace: true }); };
  useHotkeys({ F5: run, Escape: jobId ? () => openJob(null) : undefined }, [f, jobId]);
  const params = { from: A.mode === 'range' ? A.from || undefined : undefined, to: A.mode === 'range' ? A.to || undefined : undefined, branch_id: A.branch || undefined };
  const sum = useQuery({ enabled: !jobId, queryKey: ['job-report', A], queryFn: () => api.get<Summary>('/api/v1/reports/jobs', { ...params, status: A.status }) });
  const det = useQuery({ enabled: !!jobId, queryKey: ['job-report', jobId, A], queryFn: () => api.get<Detail>(`/api/v1/reports/jobs/${jobId}`, params) });
  const openJob = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('id', id); else n.delete('id'); setSp(n); };
  const ys = me?.company?.year_system ?? 'B';
  const branches = useBranches();
  const cond = useMemo(() => [A.mode === 'range' ? `ตั้งแต่ ${A.from ? formatDate(A.from, ys) : 'เริ่มต้น'} ถึง ${A.to ? formatDate(A.to, ys) : 'ปัจจุบัน'}` : 'ยอดสะสมทั้งโครงการ',
    A.branch ? `สาขา ${branches.data?.find((b) => b.id === A.branch)?.name ?? ''}` : 'ทุกสาขา', ...(!jobId ? [A.status === 'A' ? 'เฉพาะ Job ที่กำลังทำ' : A.status === 'I' ? 'เฉพาะ Job ที่ปิดแล้ว' : 'ทุกสถานะ'] : [])].join(' · '), [A, branches.data, ys, jobId]);
  const changed = JSON.stringify(A) !== JSON.stringify(f);
  const ledgerOf = (accountId: string) => {
    const j = det.data?.job;
    const from = (A.mode === 'range' && A.from) || (j?.start_date ? String(j.start_date).slice(0, 10) : `${todayIso().slice(0, 4)}-01-01`);
    const to = (A.mode === 'range' && A.to) || todayIso();
    nav(`/reports/ledger?account_id=${accountId}&from=${from}&to=${to}&job=${jobId}${A.branch ? `&branch=${A.branch}` : ''}`);
  };
  const D = det.data, S = sum.data;
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow={jobId ? 'รายงาน › ต้นทุน/กำไรตาม Job › รายละเอียด' : 'รายงาน › ต้นทุน/กำไรตาม Job'} title={D ? `Job ${D.job.code} ${D.job.name_th}` : 'ต้นทุน/กำไรตาม Job'} lead={cond}
        actions={<>
          {jobId && <button onClick={() => openJob(null)}>← ทุก Job <kbd>Esc</kbd></button>}
          <button className="primary" disabled={(sum.isFetching || det.isFetching)} onClick={run} title="แสดงรายงานตามเงื่อนไข (F5)">แสดงรายงาน <kbd>F5</kbd></button>
          <button disabled={!S && !D} onClick={() => window.print()}>🖨 พิมพ์</button>
          <ExcelButton name={D ? `ต้นทุน Job ${D.job.code}` : 'ต้นทุนกำไรตาม Job'} disabled={!S && !D} />
          {!jobId && <button onClick={() => nav('/gl/jobs')}>แฟ้ม Job</button>}
        </>} />
      <div className="filters no-print">
        <label className="inline">ช่วง <select value={f.mode} onChange={(e) => set({ mode: e.target.value as Cond['mode'] })}><option value="all">ยอดสะสมทั้งโครงการ</option><option value="range">ช่วงวันที่</option></select></label>
        {f.mode === 'range' && <><label className="inline">ตั้งแต่ <DateInput value={f.from} onChange={(v) => set({ from: v })} /></label><label className="inline">ถึง <DateInput value={f.to} onChange={(v) => set({ to: v })} /></label></>}
        {!jobId && <label className="inline">สถานะ <select value={f.status} onChange={(e) => set({ status: e.target.value as Cond['status'] })}><option value="all">ทุกสถานะ</option><option value="A">กำลังทำ</option><option value="I">ปิดแล้ว</option></select></label>}
        <BranchSelect value={f.branch} onChange={(branch) => set({ branch })} />
      </div>
      {changed && <p className="notebox no-print">เปลี่ยนเงื่อนไขแล้ว — กด แสดงรายงาน (F5) เพื่อแสดงตามเงื่อนไขใหม่</p>}
      <ErrorBox error={sum.error ?? det.error} />
      <div className="print-head print-only"><b>{me?.company?.name_th}</b><br />{D ? `ต้นทุน/กำไร Job ${D.job.code} ${D.job.name_th}` : 'ต้นทุน/กำไรตาม Job'} · {cond}</div>

      {!jobId && S && <div className="table-wrap tall">
        <table className="grid report">
          <thead><tr><th>Job</th><th>ชื่อ / ลูกค้า</th><th>สถานะ</th><th className="r">มูลค่าสัญญา</th><th className="r">รายได้</th><th className="r">ต้นทุน</th><th className="r">กำไร (ขาดทุน)</th><th className="r">%กำไร</th>
            <th className="r">งบต้นทุน</th><th className="r">งบคงเหลือ</th><th className="r">%ใช้งบ</th><th className="r" title="ซื้อสินค้าเข้าคลังโดยระบุ Job — เป็นต้นทุนเมื่อเบิกใช้">ซื้อเข้าคลังสำหรับ Job</th></tr></thead>
          <tbody>
            {S.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.status === 'I' && 'void')} onClick={() => openJob(r.id)} title="คลิกดูรายละเอียดรายบัญชี">
                <td className="mono">{r.code}</td><td>{r.name_th}{r.customer_name && <div className="muted small">{r.customer_code} {r.customer_name}</div>}</td>
                <td>{r.status === 'A' ? <Pill tone="n">กำลังทำ</Pill> : <Pill tone="x">ปิดแล้ว</Pill>}</td>
                <td className="r"><Money v={r.contract_amount} /></td><td className="r"><Money v={r.revenue} blankZero /></td><td className="r"><Money v={r.cost} blankZero /></td>
                <td className={cx('r', Number(r.profit) < 0 && 'bad')}><Money v={r.profit} paren /></td><td className="r">{pct(r.margin)}</td>
                <td className="r"><Money v={r.budget} blankZero /></td><td className={cx('r', Number(r.budget_left) < 0 && Number(r.budget) > 0 && 'bad')}>{Number(r.budget) > 0 && <Money v={r.budget_left} paren />}</td>
                <td className={cx('r', Number(r.budget_used ?? 0) > 100 && 'bad')}>{pct(r.budget_used)}</td><td className="r muted"><Money v={r.stock_for_job} blankZero /></td>
              </tr>
            ))}
            {!S.rows.length && <tr><td colSpan={12} className="empty">ยังไม่มี Job — เพิ่มที่ บัญชี › Job / โครงการ แล้วใส่ Job ในบรรทัดเอกสาร</td></tr>}
          </tbody>
          {S.rows.length > 0 && <tfoot><tr><td colSpan={3}>รวม {S.rows.length} Job</td><td className="r"><Money v={S.totals.contract_amount} blankZero /></td><td className="r"><Money v={S.totals.revenue} /></td><td className="r"><Money v={S.totals.cost} /></td>
            <td className="r"><Money v={S.totals.profit} paren /></td><td className="r">{pct(S.totals.margin)}</td><td className="r"><Money v={S.totals.budget} blankZero /></td><td /><td /><td className="r"><Money v={S.totals.stock_for_job} blankZero /></td></tr></tfoot>}
        </table>
      </div>}
      {!jobId && sum.isLoading && <p className="hint">กำลังคำนวณ…</p>}

      {jobId && D && <>
        <div className="filters" style={{ gap: 18 }}>
          <span>ลูกค้า: <b>{D.job.customer_name ? `${D.job.customer_code} ${D.job.customer_name}` : '—'}</b></span>
          {D.job.ref_no && <span>สัญญา: <b>{D.job.ref_no}</b></span>}{D.job.manager && <span>ผู้รับผิดชอบ: <b>{D.job.manager}</b></span>}
          <span>ระยะเวลา: <b><DateText v={D.job.start_date} /> – <DateText v={D.job.end_date} /></b></span>
          <span>มูลค่าสัญญา: <b><Money v={D.job.contract_amount} /></b></span>
          <span>{D.job.status === 'A' ? <Pill tone="n">กำลังทำ</Pill> : <Pill tone="x">ปิดแล้ว</Pill>}</span>
        </div>
        <div className="table-wrap tall">
          <table className="grid report">
            <thead><tr><th style={{ width: 130 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r">ยอดจริง</th><th className="r">งบประมาณ</th><th className="r">งบคงเหลือ</th><th className="r">%ใช้งบ</th></tr></thead>
            <tbody>
              {([['revenue', 'รายได้'], ['cost', 'ต้นทุน / ค่าใช้จ่าย'], ['other', 'ซื้อสินค้าเข้าคลังสำหรับ Job (ยังไม่เป็นต้นทุนจนกว่าจะเบิกใช้) และรายการงบดุลอื่น']] as const).map(([k, label]) => {
                const p = D[k];
                if (k === 'other' && !p.rows.length) return null;
                return (
                  <Fragment key={k}>
                    <tr className="acc-head total"><td colSpan={6}>{label}</td></tr>
                    {p.rows.map((r) => (
                      <tr key={r.account_id} className="row-open" onClick={() => ledgerOf(r.account_id)} title="คลิกดูแยกประเภทเฉพาะ Job นี้">
                        <td className="mono">{r.account_no}</td><td>{r.name_th}</td><td className="r"><Money v={r.actual} paren /></td><td className="r"><Money v={r.budget} /></td>
                        <td className={cx('r', r.diff !== null && Number(r.diff) < 0 && 'bad')}><Money v={r.diff} paren /></td><td className={cx('r', Number(r.used ?? 0) > 100 && 'bad')}>{pct(r.used)}</td>
                      </tr>
                    ))}
                    {!p.rows.length && <tr><td colSpan={6} className="empty">ไม่มีรายการ</td></tr>}
                    <tr className="total"><td colSpan={2}>รวม{label.split(' ')[0]}</td><td className="r"><Money v={p.actual} paren /></td><td className="r"><Money v={p.budget} blankZero /></td><td className="r">{Number(p.budget) > 0 && <Money v={p.diff} paren />}</td><td className="r">{pct(p.used)}</td></tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>กำไร (ขาดทุน) ของ Job = รายได้ − ต้นทุน {D.margin !== null && `· ${pct(D.margin)} ของรายได้`}</td><td className={cx('r', Number(D.profit) < 0 && 'bad')}><b><Money v={D.profit} paren /></b></td><td colSpan={3} /></tr></tfoot>
          </table>
        </div>
      </>}
      {jobId && det.isLoading && <p className="hint">กำลังคำนวณ…</p>}
      {!jobId && !S && !sum.isLoading && <Empty title="กด แสดงรายงาน" />}
      <p className="hint no-print">ยอดคำนวณสดจากใบสำคัญที่ระบุ Job · รายได้ = บัญชีหมวด 4 · ต้นทุน = บัญชีหมวด 5 (ค่าใช้จ่าย เบิกใช้ ต้นทุนขาย สมุดรายวัน) · ซื้อสินค้าเข้าคลังโดยใส่ Job จะเป็นต้นทุนตอนเบิกใช้ (ไม่นับซ้ำ)</p>
      <KeyHints keys={[['F5', 'แสดงรายงาน'], ['คลิก Job', 'ดูรายบัญชีเทียบงบ'], ['คลิกบัญชี', 'ดูแยกประเภทเฉพาะ Job'], ...(jobId ? [['Esc', 'กลับทุก Job'] as [string, string]] : [])]} />
    </div>
  );
}
