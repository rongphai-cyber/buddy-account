import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { cx, DateText, ErrorBox, Modal, Money, Pill } from '../ui';

interface Row { id: string; voucher_no: string; voucher_date: string; description: string | null; total_debit: string; doc_status: string; book_code: string; source_doc_no: string | null; source_doc_class: string | null }

/**
 * หน้าต่างเลือกใบสำคัญเพื่อคัดลอกรายการ — คู่มือบทที่ 15 S-GL-06 (Ctrl+F6 ที่ช่องเลขที่ใบสำคัญ)
 * แสดงใบสำคัญจากทุกสมุดและทุกระบบ ค้นหาที่เครื่องแม่ข่าย (ใบสำคัญมีได้หลายหมื่นใบ)
 */
export function JournalPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['journals', 'pick', term], queryFn: () => api.get<{ total: number; rows: Row[] }>('/api/v1/gl/journals', { q: term || undefined, limit: 100 }), placeholderData: (p) => p });
  const rows = list.data?.rows ?? [];
  useEffect(() => setSel(0), [term]);
  useEffect(() => { body.current?.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <Modal title="คัดลอกรายการจากใบสำคัญอื่น" onClose={onClose} size="wide">
      <div className="lk-bar">
        <input autoFocus className="search" placeholder="พิมพ์เลขที่ คำอธิบาย อ้างอิง หรือเลขที่เอกสารต้นทาง" value={q} data-noenter onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) onPick(rows[sel]!.id); }
          }} />
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap lk-table" ref={body}>
        <table className="grid">
          <thead><tr><th style={{ width: 150 }}>เลขที่</th><th style={{ width: 100 }}>วันที่</th><th>รายละเอียด</th><th style={{ width: 120 }}>เอกสารต้นทาง</th><th className="r" style={{ width: 130 }}>ยอดเงิน</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={cx('row-open', i === sel && 'sel', r.doc_status === 'C' && 'void')} onMouseEnter={() => setSel(i)} onClick={() => onPick(r.id)}>
                <td className="mono">{r.voucher_no}</td><td><DateText v={r.voucher_date} /></td>
                <td>{r.description}{r.doc_status === 'C' && <> <Pill tone="c">ยกเลิกแล้ว</Pill></>}</td>
                <td className="mono small">{r.source_doc_no ?? <span className="muted">{r.book_code}</span>}</td>
                <td className="r"><Money v={r.total_debit} /></td>
              </tr>
            ))}
            {!list.isFetching && !rows.length && <tr><td colSpan={5} className="empty">ไม่พบใบสำคัญ{term ? ` "${term}"` : ''}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">{list.data ? `แสดง ${rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} ใบ (ล่าสุดก่อน) · ` : ''}↑ ↓ เลือก · Enter คัดลอกรายการของใบนี้ · Esc ปิด</p>
    </Modal>
  );
}
