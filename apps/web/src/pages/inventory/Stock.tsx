import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { d, docPath, fmt, todayIso } from '@buddy/core';
import { DocLink } from '../../components/DocLink';
import { api } from '../../api';
import { useSession } from '../../session';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { cx, DateInput, DateText, ErrorBox, KeyHints, Modal, Money, PageHead } from '../../ui';

/** เอกสารต้นทางที่เปิดได้จากสต๊อกการ์ด */
interface Bal { item_id: string; item_code: string; item_name: string; unit_code: string | null; warehouse_id: string; warehouse_code: string; warehouse_name: string; qty: string; value: string; avg_cost: string | null; last_move_date: string | null }

/** ยอดสินค้าคงเหลือรายคลัง (คำนวณสดจากเอกสาร) — คลิกแถวดูสต๊อกการ์ด */
export function StockPage() {
  const lk = useLookups('WH');
  const [q, setQ] = useState('');
  const [wh, setWh] = useState<string | null>(null);
  const [zero, setZero] = useState(false);
  const [card, setCard] = useState<Bal | null>(null);
  const list = useQuery({ queryKey: ['stock', q, wh, zero], queryFn: () => api.get<{ rows: Bal[]; total_qty: string; total_value: string }>('/api/v1/stock/balances', { q, ...(wh ? { warehouse_id: wh } : {}), zero: zero ? 'Y' : 'N', limit: 2000 }), placeholderData: (p) => p });
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า" title="ยอดคงเหลือ / สต๊อกการ์ด"
        lead="ยอดคงเหลือและมูลค่าต้นทุนรายคลัง คำนวณสดจากเอกสารทุกครั้ง (ไม่ต้องสั่งคำนวณใหม่) · คลิกแถวเพื่อดูสต๊อกการ์ด" />
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหารหัส ชื่อสินค้า หรือบาร์โค้ด" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาสินค้า" />
        <label>คลัง <LkSelect byId rows={lk.data?.WH} value={wh} onChange={(v) => setWh(v || null)} aria-label="คลัง" /></label>
        <label className="check"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> แสดงรายการยอดศูนย์</label>
        <span className="muted small">{list.data ? (list.data.rows.length >= 2000 ? 'แสดง 2,000 รายการแรก — ค้นหาหรือเลือกคลังเพื่อจำกัด' : `${list.data.rows.length.toLocaleString()} รายการ`) : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 170 }}>รหัสสินค้า</th><th>ชื่อสินค้า</th><th style={{ width: 90 }}>คลัง</th><th className="r" style={{ width: 130 }}>คงเหลือ</th><th style={{ width: 70 }}>หน่วย</th><th className="r" style={{ width: 120 }}>ต้นทุน/หน่วย</th><th className="r" style={{ width: 150 }}>มูลค่า</th><th style={{ width: 110 }}>เคลื่อนไหวล่าสุด</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.item_id + r.warehouse_id} className={cx('row-open', d(r.qty).lt(0) && 'neg')} tabIndex={0} onClick={() => setCard(r)} onKeyDown={(e) => e.key === 'Enter' && setCard(r)}>
                <td className="mono">{r.item_code}</td><td>{r.item_name}</td><td className="mono">{r.warehouse_code}</td><td className={cx('r', d(r.qty).lt(0) && 'bad')}>{fmt(r.qty, { places: 2 })}</td><td>{r.unit_code}</td>
                <td className="r">{r.avg_cost ? fmt(r.avg_cost) : ''}</td><td className="r"><Money v={r.value} /></td><td><DateText v={r.last_move_date} /></td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={8} className="empty">ไม่มีสินค้าคงเหลือตามเงื่อนไขนี้</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={6} className="r">รวมมูลค่า</td><td className="r"><b><Money v={list.data.total_value} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['คลิก/Enter', 'สต๊อกการ์ด']]} />
      {card && <StockCard row={card} onClose={() => setCard(null)} />}
    </div>
  );
}

function StockCard({ row, onClose }: { row: Bal; onClose: () => void }) {
  const nav = useNavigate();
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [from, setFrom] = useState(today.slice(0, 5) + '01-01');
  const [to, setTo] = useState(today);
  const [all, setAll] = useState(false);
  const card = useQuery({ queryKey: ['stock-card', row.item_id, all ? null : row.warehouse_id, from, to], queryFn: () => api.get<{ opening: { qty: string; value: string }; closing: { qty: string; value: string };
    in: { qty: string; value: string }; out: { qty: string; value: string };
    lines: Array<{ doc_date: string; doc_class: string; doc_no: string; header_id: string; line_no: number; warehouse_code: string; party_name: string | null; qty: string; value: string; balance_qty: string; balance_value: string }> }>(
    '/api/v1/stock/card', { item_id: row.item_id, ...(all ? {} : { warehouse_id: row.warehouse_id }), from, to }) });
  const c = card.data;
  return (
    <Modal title={`สต๊อกการ์ด ${row.item_code} ${row.item_name}`} size="wide" onClose={onClose} footer={<button onClick={onClose}>ปิด <kbd>Esc</kbd></button>}>
      <div className="toolbar">
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> รวมทุกคลัง (ไม่ใช่เฉพาะ {row.warehouse_code})</label>
      </div>
      <ErrorBox error={card.error} />
      <div className="table-wrap" style={{ maxHeight: '60vh' }}>
        <table className="grid">
          <thead><tr><th style={{ width: 100 }}>วันที่</th><th style={{ width: 130 }}>เอกสาร</th>{all && <th style={{ width: 70 }}>คลัง</th>}<th>รายการ</th><th className="r" style={{ width: 110 }}>รับ</th><th className="r" style={{ width: 110 }}>จ่าย</th><th className="r" style={{ width: 120 }}>คงเหลือ</th><th className="r" style={{ width: 130 }}>มูลค่า</th><th className="r" style={{ width: 140 }}>มูลค่าคงเหลือ</th></tr></thead>
          <tbody>
            {c && <tr className="muted"><td colSpan={all ? 6 : 5}>ยอดยกมา</td><td className="r">{fmt(c.opening.qty, { places: 2 })}</td><td /><td className="r"><Money v={c.opening.value} /></td></tr>}
            {c?.lines.map((l, i) => (
              <tr key={i} className={cx(docPath(l.doc_class, l.header_id) && 'row-open')} onClick={() => { const to2 = docPath(l.doc_class, l.header_id); if (to2) nav(to2); }}>
                <td><DateText v={l.doc_date} /></td><td><DocLink id={l.header_id} no={l.doc_no} cls={l.doc_class} /></td>{all && <td className="mono">{l.warehouse_code}</td>}<td className="small">{l.party_name}</td>
                <td className="r">{d(l.qty).gt(0) ? fmt(l.qty, { places: 2 }) : ''}</td><td className="r">{d(l.qty).lt(0) ? fmt(d(l.qty).neg().toString(), { places: 2 }) : ''}</td>
                <td className="r">{fmt(l.balance_qty, { places: 2 })}</td><td className="r"><Money v={l.value} /></td><td className="r"><Money v={l.balance_value} /></td>
              </tr>
            ))}
            {c && !c.lines.length && <tr><td colSpan={9} className="empty">ไม่มีความเคลื่อนไหวในช่วงนี้</td></tr>}
          </tbody>
          {c && <tfoot><tr><td colSpan={all ? 4 : 3} className="r">รวม</td><td className="r"><b>{fmt(c.in.qty, { places: 2 })}</b></td><td className="r"><b>{fmt(c.out.qty, { places: 2 })}</b></td><td className="r"><b>{fmt(c.closing.qty, { places: 2 })}</b></td><td /><td className="r"><b><Money v={c.closing.value} /></b></td></tr></tfoot>}
        </table>
      </div>
    </Modal>
  );
}
