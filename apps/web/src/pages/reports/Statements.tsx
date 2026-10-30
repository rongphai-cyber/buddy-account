import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmt } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { PeriodRange } from '../../components/PeriodPicker';
import { cx, ErrorBox, PageHead } from '../../ui';

interface Layout { id: string; code: string; name: string; line_count: number }
type Row = { kind: 'text'; text: string; textEn: string; center: boolean } | { kind: 'rule'; double: boolean } | { kind: 'value'; text: string; textEn: string; values: (string | null)[]; account?: string; isTotal: boolean };
interface Run { title: string; headers: string[]; columns: Array<{ head1: string; head2: string; formula: boolean }>; rows: Row[]; balance_diff?: (string | null)[]; missing_accounts: string[]; coverage: { checked: boolean; missing: Array<{ account_no: string; name_th: string; amount: string }> } | null }

/** พิมพ์งบการเงิน — คู่มือบทที่ 24 S-FS-04 (แบบงบของ Express) + งบตามผังบัญชีที่ดุลกับงบทดลองเสมอ */
export function StatementsPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [sel, setSel] = useState(sp.get('layout') ?? (sp.get('kind') ? `chart:${sp.get('kind')}` : 'chart:BS'));
  const [range, setRange] = useState({ from: '', to: sp.get('end') ?? '' });
  const [lang, setLang] = useState<'th' | 'en'>('th');
  const onRange = useCallback((v: { from: string; to: string }) => setRange(v), []);
  const layouts = useQuery({ queryKey: ['fs-layouts'], queryFn: () => api.get<Layout[]>('/api/v1/fs/layouts') });
  const params = sel.startsWith('chart:') ? { kind: sel.slice(6) } : { layout_id: sel };
  const q = useQuery({ enabled: !!range.to, queryKey: ['fs-run', sel, range.to, lang, me?.branch?.id], queryFn: () => api.get<Run>('/api/v1/fs/run', { ...params, end: range.to, lang, branch_id: me?.branch?.id }) });
  const R = q.data;
  const accounts = useQuery({ queryKey: ['accounts', 'plain'], queryFn: () => api.get<Array<{ id: string; account_no: string }>>('/api/v1/gl/accounts') });
  const open = (no?: string) => { const a = no && accounts.data?.find((x) => x.account_no === no); if (a) nav(`/reports/ledger?account_id=${a.id}&to=${range.to}&from=${range.to.slice(0, 4)}-01-01`); };
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › งบการเงิน" title={R?.title ?? 'งบการเงิน'} actions={<button onClick={() => window.print()}>พิมพ์</button>} />
      <div className="filters no-print">
        <select value={sel} onChange={(e) => { setSel(e.target.value); setSp({ [e.target.value.startsWith('chart:') ? 'kind' : 'layout']: e.target.value.replace('chart:', '') }, { replace: true }); }}>
          <optgroup label="งบตามผังบัญชี (ดุลกับงบทดลองเสมอ)"><option value="chart:BS">งบแสดงฐานะการเงิน</option><option value="chart:PL">งบกำไรขาดทุน</option></optgroup>
          <optgroup label="แบบงบที่สร้างเอง (Express)">{layouts.data?.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</optgroup>
        </select>
        <PeriodRange value={range} onChange={onRange} single />
        <div className="seg"><button className={cx(lang === 'th' && 'on')} onClick={() => setLang('th')}>ไทย</button><button className={cx(lang === 'en' && 'on')} onClick={() => setLang('en')}>English</button></div>
      </div>
      <ErrorBox error={q.error} />
      {R?.balance_diff?.map((x, i) => x !== null && Math.abs(Number(x)) >= 0.005 && (
        <div key={i} className="notebox no-print">
          {i === 1
            ? <>งบปีที่แล้วไม่ดุล — สินทรัพย์ต่างจากหนี้สินและส่วนของผู้ถือหุ้น <b className="num">{fmt(x, { paren: true })}</b> · ยอดปีที่แล้วมาจากการป้อนเอง ตรวจและแก้ที่ <button className="linklike" onClick={() => nav('/gl/prior-year')}>บัญชี › ยอดปีที่แล้ว</button> (ยอดคงเหลือต้องดุล และกำไรปีนั้นต้องอยู่ในบัญชีรายได้/ค่าใช้จ่าย ไม่ใช่กำไรสะสม)</>
            : <>งบปีปัจจุบันไม่ดุล ต่าง <b className="num">{fmt(x, { paren: true })}</b> — ตรวจผังบัญชี (หมวดบัญชี) ที่ เริ่มระบบ › ผังบัญชี</>}
        </div>
      ))}
      {R?.coverage?.checked && R.coverage.missing.length > 0 && (
        <details className="notebox no-print">
          <summary>แบบงบนี้ไม่ได้ดึงบัญชีที่มียอดอยู่ {R.coverage.missing.length} บัญชี — งบอาจไม่ดุล (คลิกเพื่อดูรายการ)</summary>
          <ul className="cov">{R.coverage.missing.map((m) => <li key={m.account_no}><button className="linklike" onClick={() => open(m.account_no)}>{m.account_no}</button> {m.name_th} <b className="num">{fmt(m.amount)}</b></li>)}</ul>
          <p>แก้ได้ที่ บัญชี › สร้างงบการเงิน หรือใช้ "งบตามผังบัญชี" แทน</p>
        </details>
      )}
      {R && (
        <div className="paper statement">
          <div className="paper-title">{R.headers.filter(Boolean).map((h, i) => <div key={i} className={i === 0 ? 'strong' : ''}>{h}</div>)}</div>
          <table>
            <thead><tr><th />{R.columns.map((c, i) => <th key={i} className="r">{c.head1}{c.head2 && <><br />{c.head2}</>}</th>)}</tr></thead>
            <tbody>
              {R.rows.map((r, i) => r.kind === 'text'
                ? <tr key={i}><td colSpan={R.columns.length + 1} className={cx('txt', r.center && 'c')}>{lang === 'en' ? r.textEn || r.text : r.text}</td></tr>
                : r.kind === 'rule' ? <tr key={i} className={r.double ? 'rule2' : 'rule1'}><td /><td colSpan={R.columns.length} /></tr>
                  : <tr key={i} className={cx(r.isTotal && 'total', r.account && 'row-open')} onClick={() => open(r.account)}>
                    <td className="lbl" style={{ whiteSpace: 'pre' }}>{lang === 'en' ? r.textEn || r.text : r.text}</td>
                    {r.values.map((v, k) => <td key={k} className="r num">{v === null ? '' : R.columns[k]?.formula ? `${fmt(v)}%` : fmt(v, { paren: true })}</td>)}
                  </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
