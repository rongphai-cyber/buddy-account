import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addMonths, todayIso } from '@buddy/core';
import { api, type Book } from '../../api';
import { bookColor, bookStyle } from '../../bookColor';
import { useSession } from '../../session';
import { DocLink } from '../../components/DocLink';
import { cx, DateInput, DateText, ErrorBox, KeyHints, Money, PageHead, Pill, Tabs, useHotkeys } from '../../ui';

interface Row { id: string; voucher_no: string; voucher_date: string; description: string | null; reference: string | null; total_debit: string; doc_status: string; source_module: string | null; source_header_id: string | null; book_code: string; source_doc_no: string | null; source_doc_class: string | null }

/** ลงประจำวัน — รายการใบสำคัญ (คู่มือบทที่ 15: เลือกสมุด → รายการที่บันทึกแล้ว) */
export function JournalsPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const wd = me?.work_date ?? todayIso();
  const [f, setF] = useState({ book_id: sp.get('book') ?? '', from: sp.get('from') ?? addMonths(wd.slice(0, 8) + '01', -2), to: sp.get('to') ?? wd, q: '', source: 'all', status: 'all' });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(0);
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const params = { ...f, limit: 200, offset: page * 200 };
  const list = useQuery({ queryKey: ['journals', params], queryFn: () => api.get<{ total: number; rows: Row[] }>('/api/v1/gl/journals', params) });
  const rows = list.data?.rows ?? [];
  const set = (p: Partial<typeof f>) => { const n = { ...f, ...p }; setF(n); setPage(0); setSel(0); setSp({ book: n.book_id, from: n.from, to: n.to }, { replace: true }); };
  const newUrl = `/gl/journals/new${f.book_id ? `?book=${f.book_id}` : ''}`;
  const curBook = books.data?.find((b) => b.id === f.book_id);
  useHotkeys({ Insert: () => nav(newUrl), 'Alt+A': () => nav(newUrl), ArrowDown: () => setSel((s) => Math.min(s + 1, rows.length - 1)), ArrowUp: () => setSel((s) => Math.max(0, s - 1)), Enter: () => rows[sel] && nav(`/gl/journals/${rows[sel]!.id}`) }, [rows, sel, newUrl]);
  const total = useMemo(() => rows.filter((r) => r.doc_status === 'N').reduce((s, r) => s + Number(r.total_debit), 0), [rows]);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ลงประจำวัน" title="สมุดรายวัน" lead="ใบสำคัญที่บันทึกเองและที่ลงบัญชีอัตโนมัติจากระบบอื่น — คลิกแถวเพื่อเปิด"
        actions={<button className={cx('primary', curBook && 'book-btn')} style={bookStyle(bookColor(curBook))} onClick={() => nav(newUrl)} title={curBook ? `บันทึกใบสำคัญใน${curBook.name_th}` : 'บันทึกใบสำคัญ — เลือกสมุดรายวันในหน้าถัดไป'}>+ บันทึกใบสำคัญ{curBook ? ` ${curBook.prefix}` : ''} <kbd>Ins</kbd></button>} />
      {/* สมุดรายวันเป็นแถบ: เลือกสมุดก่อน แล้ว "บันทึกใบสำคัญ" ลงสมุดนั้น */}
      <Tabs active={f.book_id} onChange={(k) => set({ book_id: k })} tabs={[{ key: '', label: 'ทุกสมุดรายวัน' }, ...(books.data ?? []).map((b) => ({ key: b.id, label: `${b.prefix} ${b.name_th}`, color: bookColor(b) }))]} />
      <div className="filters">
        <span className="inline">ตั้งแต่ <DateInput value={f.from} onChange={(v) => set({ from: v })} /></span>
        <span className="inline">ถึง <DateInput value={f.to} onChange={(v) => set({ to: v })} /></span>
        <input className="search" placeholder="ค้นหาเลขที่ คำอธิบาย อ้างอิง" value={f.q} onChange={(e) => set({ q: e.target.value })} data-noenter />
        <select value={f.source} onChange={(e) => set({ source: e.target.value })}><option value="all">ทุกแหล่ง</option><option value="gl">บันทึกเองใน GL</option><option value="other">จากระบบอื่น</option></select>
        <select value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="all">ทุกสถานะ</option><option value="N">ปกติ</option><option value="C">ยกเลิก</option></select>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th>วันที่</th><th>เลขที่ใบสำคัญ</th><th>สมุด</th><th>คำอธิบาย</th><th>อ้างอิง / เอกสารต้นทาง</th><th className="r">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={cx('row-open', i === sel && 'sel', r.doc_status === 'C' && 'void')} onClick={() => nav(`/gl/journals/${r.id}`)} onMouseEnter={() => setSel(i)}>
                <td className="mono"><DateText v={r.voucher_date} /></td><td className="mono">{r.voucher_no}</td><td className="mono">{r.book_code}</td>
                <td>{r.description}</td>
                <td className="small">{r.source_doc_no ? <span>{r.source_doc_class} <DocLink id={r.source_header_id} no={r.source_doc_no} cls={r.source_doc_class} /></span> : r.reference}</td>
                <td className="r"><Money v={r.total_debit} /></td>
                <td>{r.doc_status === 'C' ? <Pill tone="c">ยกเลิก</Pill> : r.source_header_id ? <Pill tone="x">จากระบบอื่น</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {!rows.length && !list.isLoading && <tr><td colSpan={7} className="empty">ไม่มีใบสำคัญในช่วงนี้ — กด <kbd>Ins</kbd> เพื่อบันทึกใหม่</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={5}>รวม {list.data?.total.toLocaleString()} ใบ (หน้านี้ {rows.length})</td><td className="r"><Money v={total} /></td><td /></tr></tfoot>}
        </table>
      </div>
      {(list.data?.total ?? 0) > 200 && (
        <div className="actions"><button disabled={page === 0} onClick={() => setPage(page - 1)}>‹ ก่อนหน้า</button><span className="summary">หน้า {page + 1} / {Math.ceil((list.data?.total ?? 0) / 200)}</span><button disabled={(page + 1) * 200 >= (list.data?.total ?? 0)} onClick={() => setPage(page + 1)}>ถัดไป ›</button></div>
      )}
      <KeyHints keys={[['Ins', 'บันทึกใหม่'], ['↑↓', 'เลือก'], ['Enter', 'เปิด'], ['Alt+1–8', 'เมนูหลัก']]} />
    </div>
  );
}
