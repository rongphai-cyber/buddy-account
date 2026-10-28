import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api, type Department, type FiscalYear } from '../../api';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { cx, DateText, ErrorBox, KeyHints, MoneyInput, navKey, PageHead, toast, useHotkeys } from '../../ui';

interface Row { key: number; account_id: string | null; department_id: string | null; debit: string; credit: string }
let k = 0;

/** บันทึกยอดยกมา GL — คู่มือบทที่ 8 S-OB-06 (ตรวจด้วยงบทดลองแบบเต็ม S-OB-07) */
export function OpeningPage() {
  const qc = useQueryClient();
  const accts = useAccounts();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const years = useQuery({ queryKey: ['periods'], queryFn: () => api.get<FiscalYear[]>('/api/v1/gl/periods') });
  const cur = useQuery({ queryKey: ['opening'], queryFn: () => api.get<{ as_of_period_start: string | null; rows: Array<{ account_id: string; department_id: string | null; opening: string; start_date: string }>; net: string }>('/api/v1/gl/opening') });
  const [rows, setRows] = useState<Row[]>([]);
  const [start, setStart] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!cur.data) return;
    setRows([...cur.data.rows.map((r) => ({ key: ++k, account_id: r.account_id, department_id: r.department_id, debit: d(r.opening).isPositive() ? r.opening : '', credit: d(r.opening).isNegative() ? d(r.opening).neg().toFixed(2) : '' })), { key: ++k, account_id: null, department_id: null, debit: '', credit: '' }]);
    setStart(cur.data.as_of_period_start ?? years.data?.[0]?.start_date ?? '');
  }, [cur.data, years.data]);
  const tot = useMemo(() => rows.reduce((s, r) => ({ dr: s.dr.plus(d(r.debit)), cr: s.cr.plus(d(r.credit)) }), { dr: d(0), cr: d(0) }), [rows]);
  const set = (key: number, p: Partial<Row>) => setRows((rs) => { const n = rs.map((r) => (r.key === key ? { ...r, ...p } : r)); if (n.at(-1)!.account_id) n.push({ key: ++k, account_id: null, department_id: null, debit: '', credit: '' }); return n; });
  const save = () => api.put('/api/v1/gl/opening', { period_start: start, rows: rows.filter((r) => r.account_id).map((r) => ({ account_id: r.account_id, department_id: r.department_id, debit: r.debit || '0', credit: r.credit || '0' })) })
    .then(() => { toast('บันทึกยอดยกมาแล้ว'); qc.invalidateQueries(); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [rows, start]);
  const name = (id: string | null) => accts.data?.find((a) => a.id === id)?.name_th ?? '';
  const diff = tot.dr.minus(tot.cr);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › บันทึกยอดยกมา" title="ยอดยกมาบัญชีแยกประเภท" lead={<>ยอดยกมา ณ ต้นงวดแรกของรอบบัญชี <b><DateText v={start} /></b> — เดบิตรวมต้องเท่ากับเครดิตรวม แล้วตรวจด้วยงบทดลอง</>}
        actions={<button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <label className="inline">งวดที่เริ่มใช้ <select value={start} onChange={(e) => setStart(e.target.value)}>{years.data?.flatMap((y) => y.periods.slice(0, 1).map((p) => <option key={p.id} value={p.start_date}>ปี {y.code} (เริ่ม {p.start_date})</option>))}</select></label>
      <ErrorBox error={err} />
      <div className="table-wrap lines tall" onKeyDown={navKey}>
        <table className="grid">
          <thead><tr><th style={{ width: 180 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 120 }}>แผนก</th><th className="r" style={{ width: 160 }}>เดบิต</th><th className="r" style={{ width: 160 }}>เครดิต</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><AccountCell value={r.account_id} onChange={(a) => set(r.key, { account_id: a?.id ?? null })} /></td>
                <td className="small">{name(r.account_id)}</td>
                <td><select value={r.department_id ?? ''} onChange={(e) => set(r.key, { department_id: e.target.value || null })}><option value="">—</option>{depts.data?.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></td>
                <td><MoneyInput value={r.debit} onChange={(v) => set(r.key, { debit: v, credit: v ? '' : r.credit })} /></td>
                <td><MoneyInput value={r.credit} onChange={(v) => set(r.key, { credit: v, debit: v ? '' : r.debit })} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>รวม {rows.filter((r) => r.account_id).length} บัญชี · <span className={cx(!diff.isZero() && 'bad')}>{diff.isZero() ? 'ดุล ✓' : `ต่างกัน ${fmt(diff.abs())}`}</span></td><td className="r num">{fmt(tot.dr)}</td><td className="r num">{fmt(tot.cr)}</td></tr></tfoot>
        </table>
      </div>
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหาบัญชี'], ['F9', 'บันทึก']]} />
    </div>
  );
}
