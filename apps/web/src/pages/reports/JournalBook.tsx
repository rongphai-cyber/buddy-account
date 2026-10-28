import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fmt, formatDate } from '@buddy/core';
import { api, type Book } from '../../api';
import { useSession } from '../../session';
import { PeriodRange } from '../../components/PeriodPicker';
import { ErrorBox, PageHead } from '../../ui';

interface R { rows: Array<{ id: string; voucher_no: string; voucher_date: string; description: string | null; book_code: string; lines: Array<{ account_no: string; name_th: string; description: string | null; debit: string; credit: string }> }>; truncated: boolean }

/** รายงานสมุดรายวัน */
export function JournalBookPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const ys = me?.company?.year_system ?? 'B';
  const [range, setRange] = useState({ from: '', to: '' });
  const [book, setBook] = useState('');
  const onRange = useCallback((v: { from: string; to: string }) => setRange({ from: v.to.slice(0, 8) + '01', to: v.to }), []);
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const q = useQuery({ enabled: !!range.from && !!book, queryKey: ['jbook', range, book], queryFn: () => api.get<R>('/api/v1/reports/journal-book', { ...range, book_id: book }) });
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › สมุดรายวัน" title="รายงานสมุดรายวัน" lead={range.from ? `${formatDate(range.from, ys)} – ${formatDate(range.to, ys)}` : undefined} actions={<button onClick={() => window.print()}>พิมพ์</button>} />
      <div className="filters no-print">
        <select value={book} onChange={(e) => setBook(e.target.value)}><option value="">— เลือกสมุดรายวัน —</option>{books.data?.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name_th}</option>)}</select>
        <PeriodRange value={range} onChange={onRange} single />
      </div>
      <ErrorBox error={q.error} />
      {q.data && (
        <div className="table-wrap">
          <table className="grid report">
            <thead><tr><th>วันที่</th><th>เลขที่</th><th>เลขที่บัญชี</th><th>ชื่อบัญชี / คำอธิบาย</th><th className="r">เดบิต</th><th className="r">เครดิต</th></tr></thead>
            <tbody>
              {q.data.rows.map((j) => [
                <tr key={j.id} className="row-open sub" onClick={() => nav(`/gl/journals/${j.id}`)}><td className="mono">{formatDate(j.voucher_date, ys)}</td><td className="mono">{j.voucher_no}</td><td colSpan={4}>{j.description}</td></tr>,
                ...j.lines.map((l, i) => <tr key={j.id + i}><td /><td /><td className="mono">{l.account_no}</td><td>{l.name_th}{l.description && <span className="muted small"> · {l.description}</span>}</td><td className="r num">{Number(l.debit) ? fmt(l.debit) : ''}</td><td className="r num">{Number(l.credit) ? fmt(l.credit) : ''}</td></tr>),
              ])}
              {!q.data.rows.length && <tr><td colSpan={6} className="empty">ไม่มีรายการ</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {q.data?.truncated && <p className="notebox">แสดง 5,000 ใบแรก — เลือกช่วงวันที่ให้แคบลง</p>}
    </div>
  );
}
