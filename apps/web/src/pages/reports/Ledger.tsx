import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, formatDate } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { PeriodRange } from '../../components/PeriodPicker';
import { DateText, downloadCsv, Empty, ErrorBox, Money, PageHead } from '../../ui';
import { DocLink } from '../../components/DocLink';

interface Ledger { account: { account_no: string; name_th: string; is_control: boolean }; opening: string; debit: string; credit: string; closing: string; rows: Array<{ journal_id: string; voucher_no: string; voucher_date: string; description: string | null; journal_description: string | null; debit: string; credit: string; balance: string; account_no: string; department_code: string | null; source_doc_no: string | null; source_header_id: string | null; source_doc_class: string | null }> }

/** บัญชีแยกประเภท — เปิดจากงบทดลอง/ผังบัญชี หรือเลือกบัญชีเอง; คลิกรายการเพื่อเปิดใบสำคัญ */
export function LedgerPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [acc, setAcc] = useState<string | null>(sp.get('account_id'));
  const [range, setRange] = useState({ from: sp.get('from') ?? '', to: sp.get('to') ?? '' });
  const onRange = useCallback((v: { from: string; to: string }) => { setRange(v); setSp((p) => { p.set('from', v.from); p.set('to', v.to); return p; }, { replace: true }); }, [setSp]);
  const q = useQuery({ enabled: !!acc && !!range.from, queryKey: ['ledger', acc, range, me?.branch?.id], queryFn: () => api.get<Ledger>('/api/v1/reports/ledger', { account_id: acc, ...range, branch_id: me?.branch?.id }) });
  const ys = me?.company?.year_system ?? 'B';
  const L = q.data;
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › บัญชีแยกประเภท" title={L ? `${L.account.account_no} ${L.account.name_th}` : 'บัญชีแยกประเภท'} lead={L?.account.is_control ? 'บัญชีคุม — แสดงรายการของบัญชีย่อยทั้งหมด' : undefined}
        actions={L && <><button onClick={() => window.print()}>พิมพ์</button><button onClick={() => downloadCsv(`แยกประเภท_${L.account.account_no}`, ['วันที่', 'เลขที่', 'บัญชี', 'คำอธิบาย', 'เดบิต', 'เครดิต', 'คงเหลือ'], [['', '', '', 'ยอดยกมา', '', '', L.opening], ...L.rows.map((r) => [formatDate(r.voucher_date, ys), r.voucher_no, r.account_no, r.description || r.journal_description, r.debit, r.credit, r.balance])])}>ส่งออก Excel</button></>} />
      <div className="filters no-print">
        <span className="inline acc-pick">บัญชี <AccountCell value={acc} postableOnly={false} onChange={(a) => { setAcc(a?.id ?? null); if (a) setSp((p) => { p.set('account_id', a.id); return p; }, { replace: true }); }} /></span>
        <PeriodRange value={range} onChange={onRange} />
      </div>
      <ErrorBox error={q.error} />
      {!acc && <Empty title="เลือกบัญชี" text="พิมพ์เลขที่บัญชี หรือกด F4 เพื่อค้นหา" />}
      {L && (
        <div className="table-wrap tall">
          <table className="grid report">
            <thead><tr><th>วันที่</th><th>เลขที่ใบสำคัญ</th>{L.account.is_control && <th>บัญชี</th>}<th>คำอธิบาย</th><th>แผนก</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th className="r">คงเหลือ</th></tr></thead>
            <tbody>
              <tr className="sub"><td colSpan={L.account.is_control ? 5 : 4}>ยอดยกมา ณ {formatDate(range.from, ys)}</td><td /><td /><td className="r"><Money v={L.opening} paren /></td></tr>
              {L.rows.map((r, i) => (
                <tr key={i} className="row-open" onClick={() => nav(`/gl/journals/${r.journal_id}`)}>
                  <td className="mono"><DateText v={r.voucher_date} /></td><td className="mono">{r.voucher_no}</td>{L.account.is_control && <td className="mono">{r.account_no}</td>}
                  <td>{r.description || r.journal_description}{r.source_doc_no && <span className="muted small"> · <DocLink id={r.source_header_id} no={r.source_doc_no} cls={r.source_doc_class} /></span>}</td><td className="mono small">{r.department_code}</td>
                  <td className="r"><Money v={r.debit} blankZero /></td><td className="r"><Money v={r.credit} blankZero /></td><td className="r"><Money v={r.balance} paren /></td>
                </tr>
              ))}
              {!L.rows.length && <tr><td colSpan={8} className="empty">ไม่มีรายการในช่วงนี้</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={L.account.is_control ? 5 : 4}>รวม {L.rows.length} รายการ · คงเหลือยกไป</td><td className="r">{fmt(L.debit)}</td><td className="r">{fmt(L.credit)}</td><td className="r">{fmt(L.closing, { paren: true })}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
