import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api, type Department } from '../../api';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { cx, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, PageHead, toast, useHotkeys } from '../../ui';

interface Year { id: string; code: string; start_date: string; end_date: string }
interface Summary { year: Year; years: Year[]; rows: Array<{ account_id: string; account_no: string; name_th: string; department_id: string | null; department_code: string | null; total: string }> }
interface Entry { is_pl: boolean; periods: Array<{ period_no: number; start_date: string; end_date: string; budget: string; actual: string; last_year: string }> }

/** งบประมาณ — คู่มือบทที่ 15 S-GL-17 (บัญชี › 4. งบประมาณ) · ใช้ในแบบงบด้วยคอลัมน์ BUD / PTD BUD */
export function BudgetPage() {
  const [fyId, setFyId] = useState('');
  const q = useQuery({ queryKey: ['budget', fyId], queryFn: () => api.get<Summary>('/api/v1/gl/budget', { fiscal_year_id: fyId || undefined }) });
  const [edit, setEdit] = useState<{ account_id: string | null; department_id: string | null } | null>(null);
  useHotkeys({ Insert: () => setEdit({ account_id: null, department_id: null }) }, []);
  const s = q.data;
  const total = s?.rows.reduce((t, r) => t.plus(d(r.total)), d(0)) ?? d(0);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › งบประมาณ" title="งบประมาณ"
        lead="ป้อนงบประมาณรายงวดต่อบัญชี (และแผนก) เป็นยอดตามด้านปกติ เช่น ค่าใช้จ่ายหรือรายได้ที่คาดไว้เป็นบวก — เทียบกับยอดจริงปีนี้และปีที่แล้วได้ทันที และใส่ในแบบงบการเงินด้วยคอลัมน์ BUD (สะสม) / PTD BUD (งวดนี้)"
        actions={<button className="primary" onClick={() => setEdit({ account_id: null, department_id: null })}>+ ป้อนงบประมาณ <kbd>Ins</kbd></button>} />
      <div className="filters">
        <label className="inline">ปีบัญชี{' '}
          <select value={fyId || s?.year.id || ''} onChange={(e) => setFyId(e.target.value)}>
            {s?.years.map((y) => <option key={y.id} value={y.id}>ปี {y.code}</option>)}
          </select>
        </label>
        {s && <span className="muted"><DateText v={s.year.start_date} /> – <DateText v={s.year.end_date} /></span>}
      </div>
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 90 }}>แผนก</th><th className="r" style={{ width: 170 }}>งบประมาณทั้งปี</th></tr></thead>
          <tbody>
            {s?.rows.map((r) => (
              <tr key={r.account_id + (r.department_id ?? '')} className="row-open" onClick={() => setEdit({ account_id: r.account_id, department_id: r.department_id })}>
                <td className="mono">{r.account_no}</td><td>{r.name_th}</td><td className="mono">{r.department_code}</td><td className="r"><Money v={r.total} /></td>
              </tr>
            ))}
            {s && !s.rows.length && <tr><td colSpan={4} className="empty">ยังไม่มีงบประมาณปี {s.year.code} — กด <kbd>Ins</kbd> เพื่อป้อนทีละบัญชี</td></tr>}
          </tbody>
          {s && s.rows.length > 0 && <tfoot><tr><td colSpan={3}>รวม {s.rows.length} รายการ</td><td className="r num">{fmt(total)}</td></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'ป้อนงบประมาณ'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && s && <BudgetForm year={s.year} init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BudgetForm({ year, init, onClose }: { year: Year; init: { account_id: string | null; department_id: string | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const accts = useAccounts();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const [acc, setAcc] = useState(init.account_id);
  const [dept, setDept] = useState(init.department_id);
  const e = useQuery({ enabled: !!acc, queryKey: ['budget-entry', year.id, acc, dept], queryFn: () => api.get<Entry>('/api/v1/gl/budget/entry', { fiscal_year_id: year.id, account_id: acc, department_id: dept }), staleTime: 0 });
  const [amt, setAmt] = useState<string[]>(Array(12).fill(''));
  const [annual, setAnnual] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (e.data) setAmt(e.data.periods.map((p) => (d(p.budget).isZero() ? '' : p.budget))); }, [e.data]);
  const P = e.data?.periods ?? [];
  const tot = useMemo(() => ({
    bud: amt.reduce((t, v) => t.plus(d(v)), d(0)),
    act: P.reduce((t, p) => t.plus(d(p.actual)), d(0)),
    ly: P.reduce((t, p) => t.plus(d(p.last_year)), d(0)),
  }), [amt, P]);
  // กระจายยอดทั้งปีเท่ากัน 12 งวด เศษสตางค์ไปงวดสุดท้าย
  const spread = () => {
    const t = d(annual); if (t.isZero()) return;
    const each = t.div(12).toDecimalPlaces(2, 1);
    setAmt(Array.from({ length: 12 }, (_, i) => (i < 11 ? each : t.minus(each.times(11))).toFixed(2)));
  };
  const save = async () => {
    if (!acc || busy) return;
    setErr(null); setBusy(true);
    try {
      await api.put('/api/v1/gl/budget/entry', { fiscal_year_id: year.id, account_id: acc, department_id: dept, periods: amt.map((v, i) => ({ period_no: i + 1, amount: v || '0' })) });
      toast('บันทึกงบประมาณเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['budget'] }); qc.invalidateQueries({ queryKey: ['budget-entry'] });
      onClose();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [acc, dept, amt, busy]);
  const a = accts.data?.find((x) => x.id === acc);
  const pct = (b: ReturnType<typeof d>, x: ReturnType<typeof d>) => (b.isZero() ? '' : `${x.div(b).times(100).toFixed(0)}%`);
  return (
    <Modal title={`งบประมาณ — ปี ${year.code}`} size="wide" onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!acc || busy} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? e.error} />
      <div className="form-grid">
        <Field label="เลขที่บัญชี" req hint={a ? a.name_th : 'บัญชีย่อยเท่านั้น · F4 ค้นหา'}><AccountCell value={acc} autoFocus={!acc} onChange={(x) => setAcc(x?.id ?? null)} /></Field>
        <Field label="แผนก" hint="ว่าง = ไม่แยกแผนก">
          <select value={dept ?? ''} onChange={(x) => setDept(x.target.value || null)}>
            <option value="">—</option>
            {depts.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}
          </select>
        </Field>
      </div>
      {acc && e.data && (
        <>
          <div className="filters">
            <label className="inline">ยอดทั้งปี <MoneyInput value={annual} onChange={setAnnual} data-noenter /></label>
            <button type="button" onClick={spread} disabled={d(annual).isZero()}>กระจายเท่ากัน 12 งวด</button>
            <button type="button" onClick={() => setAmt(P.map((p) => (d(p.last_year).isZero() ? '' : p.last_year)))}>เติมจากยอดจริงปีที่แล้ว</button>
          </div>
          <div className="table-wrap lines">
            <table className="grid">
              <thead><tr><th style={{ width: 60 }}>งวด</th><th>ช่วงวันที่</th><th className="r" style={{ width: 160 }}>งบประมาณ</th><th className="r">ยอดจริงปีนี้</th><th className="r">ต่างจากงบ</th><th className="r" style={{ width: 70 }}>% ใช้ไป</th><th className="r">ปีที่แล้ว</th></tr></thead>
              <tbody>
                {P.map((p, i) => {
                  const b = d(amt[i]); const x = d(p.actual); const diff = x.minus(b);
                  return (
                    <tr key={p.period_no}>
                      <td>{p.period_no}</td><td className="small"><DateText v={p.start_date} /> – <DateText v={p.end_date} /></td>
                      <td><MoneyInput value={amt[i]} onChange={(v) => setAmt((s) => s.map((y, j) => (j === i ? v : y)))} /></td>
                      <td className="r"><Money v={p.actual} blankZero paren /></td>
                      <td className={cx('r', !b.isZero() && diff.isPositive() && 'bad')}>{b.isZero() && x.isZero() ? '' : <Money v={diff.toFixed(2)} paren />}</td>
                      <td className="r small">{pct(b, x)}</td>
                      <td className="r muted"><Money v={p.last_year} blankZero paren /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={2}>รวมทั้งปี</td><td className="r num">{fmt(tot.bud)}</td><td className="r num">{fmt(tot.act, { paren: true })}</td>
                <td className={cx('r num', !tot.bud.isZero() && tot.act.minus(tot.bud).isPositive() && 'bad')}>{fmt(tot.act.minus(tot.bud), { paren: true })}</td><td className="r small">{pct(tot.bud, tot.act)}</td><td className="r num">{fmt(tot.ly, { paren: true })}</td></tr></tfoot>
            </table>
          </div>
          <p className="hint">ยอดจริงและงบประมาณเป็นยอดตามด้านปกติของบัญชี · "ต่างจากงบ" เป็นบวก (สีแดง) = ใช้/ได้เกินงบ · ปีที่แล้วรวมยอดที่ป้อนในหน้ายอดปีที่แล้ว</p>
        </>
      )}
    </Modal>
  );
}
