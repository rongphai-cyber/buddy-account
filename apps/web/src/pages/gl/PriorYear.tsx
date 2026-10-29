import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api, type Department } from '../../api';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { cx, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, PageHead, toast, useHotkeys } from '../../ui';

interface Year { id: string | null; code: string; start_date: string; end_date: string }
interface Summary {
  current: Year; prior: Year; voucher_count: number; years: Array<{ id: string; code: string; start_date: string; end_date: string }>;
  rows: Array<{ account_id: string; account_no: string; name_th: string; department_id: string | null; department_code: string | null; opening: string; debit: string; credit: string; closing: string }>;
  closing_debit: string; closing_credit: string;
}
interface Entry {
  read_only: boolean; is_pl: boolean; current_opening: string; opening: { debit: string; credit: string };
  periods: Array<{ period_no: number; start_date: string; end_date: string; debit: string; credit: string }>;
}
const blank = (v: string) => (d(v).isZero() ? '' : v);

/** ยอดปีที่แล้ว — คู่มือบทที่ 15 S-GL-16 (บัญชี › 3.2 ยอดปีที่แล้ว) สำหรับงบเปรียบเทียบ */
export function PriorYearPage() {
  const [fyId, setFyId] = useState('');
  const q = useQuery({ queryKey: ['prior-year', fyId], queryFn: () => api.get<Summary>('/api/v1/gl/prior-year', { fiscal_year_id: fyId || undefined }) });
  const [edit, setEdit] = useState<{ account_id: string | null; department_id: string | null } | null>(null);
  useHotkeys({ Insert: () => setEdit({ account_id: null, department_id: null }) }, []);
  const s = q.data;
  const diff = s ? d(s.closing_debit).minus(d(s.closing_credit)) : d(0);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ยอดยกมา/ยอดปีที่แล้ว" title="ยอดปีที่แล้ว"
        lead="ใช้ทำงบการเงินเปรียบเทียบ (คอลัมน์ปีที่แล้ว) — ป้อนเมื่อปีที่แล้วไม่มีใบสำคัญในโปรแกรม เช่น เริ่มใช้กลางปีหรือย้ายมาจากโปรแกรมอื่น · ไม่กระทบยอดปีปัจจุบัน (ยอดยกมาปีนี้ป้อนที่หน้าบันทึกยอดยกมา)"
        actions={s && <button className="primary" onClick={() => setEdit({ account_id: null, department_id: null })}>{s.voucher_count ? 'ดูยอดบัญชี' : '+ ป้อนยอดบัญชี'} <kbd>Ins</kbd></button>} />
      <div className="filters">
        <label className="inline">ปีปัจจุบัน{' '}
          <select value={fyId || s?.current.id || ''} onChange={(e) => setFyId(e.target.value)}>
            {s?.years.map((y) => <option key={y.id} value={y.id}>ปี {y.code}</option>)}
          </select>
        </label>
        {s && <span>ปีที่แล้ว: <b>ปี {s.prior.code}</b> (<DateText v={s.prior.start_date} /> – <DateText v={s.prior.end_date} />){!s.prior.id && <span className="muted"> · ยังไม่มีในรอบบัญชี จะสร้างให้เมื่อบันทึก</span>}</span>}
      </div>
      <ErrorBox error={q.error} />
      {s && s.voucher_count > 0 && (
        <p className="notebox">ปี {s.prior.code} มีใบสำคัญในโปรแกรม {s.voucher_count.toLocaleString()} ใบ — ยอดปีที่แล้วคำนวณจากใบสำคัญให้อัตโนมัติ ไม่ต้องป้อน (กด "ดูยอดบัญชี" เพื่อดูยอดรายงวด)</p>
      )}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 90 }}>แผนก</th><th className="r">ยอดยกมา</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">คงเหลือสิ้นปี</th></tr></thead>
          <tbody>
            {s?.rows.map((r) => (
              <tr key={r.account_id + (r.department_id ?? '')} className="row-open" onClick={() => setEdit({ account_id: r.account_id, department_id: r.department_id })}>
                <td className="mono">{r.account_no}</td><td>{r.name_th}</td><td className="mono">{r.department_code}</td>
                <td className="r"><Money v={r.opening} blankZero paren /></td><td className="r"><Money v={r.debit} blankZero /></td><td className="r"><Money v={r.credit} blankZero /></td><td className="r"><Money v={r.closing} paren /></td>
              </tr>
            ))}
            {s && !s.rows.length && <tr><td colSpan={7} className="empty">{s.voucher_count ? 'ปีที่แล้วใช้ยอดจากใบสำคัญ' : <>ยังไม่ได้ป้อนยอดปีที่แล้ว — กด <kbd>Ins</kbd> เพื่อป้อนทีละบัญชี</>}</td></tr>}
          </tbody>
          {s && s.rows.length > 0 && (
            <tfoot><tr><td colSpan={3}>รวม {s.rows.length} รายการ · คงเหลือสิ้นปีเดบิต {fmt(s.closing_debit)} เครดิต {fmt(s.closing_credit)}</td>
              <td colSpan={4} className={cx('r', !diff.isZero() && 'bad')}>{diff.isZero() ? 'ดุล ✓' : `ยังไม่ดุล ต่างกัน ${fmt(diff.abs())}`}</td></tr></tfoot>
          )}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'ป้อนยอดบัญชี'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && s && <EntryForm s={s} fyId={fyId || s.current.id!} init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EntryForm({ s, fyId, init, onClose }: { s: Summary; fyId: string; init: { account_id: string | null; department_id: string | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const accts = useAccounts();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const [acc, setAcc] = useState(init.account_id);
  const [dept, setDept] = useState(init.department_id);
  const e = useQuery({ enabled: !!acc, queryKey: ['prior-year-entry', fyId, acc, dept], queryFn: () => api.get<Entry>('/api/v1/gl/prior-year/entry', { fiscal_year_id: fyId, account_id: acc, department_id: dept }), staleTime: 0 });
  const [op, setOp] = useState({ debit: '', credit: '' });
  const [rows, setRows] = useState<Array<{ debit: string; credit: string }>>(Array.from({ length: 12 }, () => ({ debit: '', credit: '' })));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!e.data) return;
    setOp({ debit: blank(e.data.opening.debit), credit: blank(e.data.opening.credit) });
    setRows(e.data.periods.map((p) => ({ debit: blank(p.debit), credit: blank(p.credit) })));
  }, [e.data]);
  const ro = !!e.data?.read_only || !!s.voucher_count;
  const tot = useMemo(() => {
    const dr = rows.reduce((x, r) => x.plus(d(r.debit)), d(0));
    const cr = rows.reduce((x, r) => x.plus(d(r.credit)), d(0));
    const opening = d(op.debit).minus(d(op.credit));
    return { dr, cr, opening, closing: opening.plus(dr).minus(cr) };
  }, [rows, op]);
  const cur = d(e.data?.current_opening ?? '0');
  const gap = e.data && !e.data.is_pl ? tot.closing.minus(cur) : d(0);
  const save = async () => {
    if (!acc || ro || busy) return;
    setErr(null); setBusy(true);
    try {
      await api.put('/api/v1/gl/prior-year/entry', { fiscal_year_id: fyId, account_id: acc, department_id: dept, opening: { debit: op.debit || '0', credit: op.credit || '0' }, periods: rows.map((r, i) => ({ period_no: i + 1, debit: r.debit || '0', credit: r.credit || '0' })) });
      toast('บันทึกยอดปีที่แล้วเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['prior-year'] }); qc.invalidateQueries({ queryKey: ['prior-year-entry'] }); qc.invalidateQueries({ queryKey: ['periods'] });
      onClose();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [acc, dept, op, rows, ro, busy]);
  const a = accts.data?.find((x) => x.id === acc);
  const setRow = (i: number, p: Partial<{ debit: string; credit: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Modal title={`ยอดปีที่แล้ว — ปี ${s.prior.code}`} size="wide" onClose={onClose}
      footer={<><button onClick={onClose}>{ro ? 'ปิด' : 'ยกเลิก'} <kbd>Esc</kbd></button>{!ro && <button className="primary" disabled={!acc || busy} onClick={save}>บันทึก <kbd>F9</kbd></button>}</>}>
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
      {ro && <p className="notebox">ปีนี้มีใบสำคัญในโปรแกรม — ยอดด้านล่างคำนวณจากใบสำคัญ ดูได้อย่างเดียว</p>}
      {acc && (
        <fieldset disabled={ro} className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 90 }}>งวด</th><th>ช่วงวันที่</th><th className="r" style={{ width: 170 }}>เดบิต</th><th className="r" style={{ width: 170 }}>เครดิต</th></tr></thead>
            <tbody>
              <tr>
                <td><b>ยกมา</b></td><td className="muted small">{e.data?.is_pl ? 'บัญชีรายได้/ค่าใช้จ่ายไม่มียอดยกมา' : <>ยอดยกมาต้นปีที่แล้ว ณ <DateText v={s.prior.start_date} /></>}</td>
                <td><MoneyInput value={op.debit} disabled={e.data?.is_pl} onChange={(v) => setOp({ debit: v, credit: v ? '' : op.credit })} /></td>
                <td><MoneyInput value={op.credit} disabled={e.data?.is_pl} onChange={(v) => setOp({ credit: v, debit: v ? '' : op.debit })} /></td>
              </tr>
              {e.data?.periods.map((p, i) => (
                <tr key={p.period_no}>
                  <td>{p.period_no}</td><td className="small"><DateText v={p.start_date} /> – <DateText v={p.end_date} /></td>
                  <td><MoneyInput value={rows[i]?.debit} onChange={(v) => setRow(i, { debit: v })} /></td>
                  <td><MoneyInput value={rows[i]?.credit} onChange={(v) => setRow(i, { credit: v })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>รวมเคลื่อนไหวทั้งปี</td><td className="r num">{fmt(tot.dr)}</td><td className="r num">{fmt(tot.cr)}</td></tr>
              <tr><td colSpan={2}>คงเหลือสิ้นปีที่แล้ว</td><td colSpan={2} className="r num"><b>{fmt(tot.closing, { paren: true })}</b> {tot.closing.isNegative() ? 'เครดิต' : tot.closing.isZero() ? '' : 'เดบิต'}</td></tr>
              {e.data && !e.data.is_pl && (
                <tr><td colSpan={2}>ยอดยกมาปีปัจจุบัน{dept ? '' : ' (ทุกแผนก)'}</td>
                  <td colSpan={2} className={cx('r num', !gap.isZero() && 'bad')}>{fmt(cur, { paren: true })}{!gap.isZero() && <> · ต่างจากคงเหลือสิ้นปีที่แล้ว {fmt(gap.abs())}</>}</td></tr>
              )}
            </tfoot>
          </table>
        </fieldset>
      )}
    </Modal>
  );
}
