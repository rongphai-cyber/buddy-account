import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, DateText, ErrorBox } from '../../ui';
import { DocLink } from '../../components/DocLink';

type Cand = { count: number; rows: Array<{ id: string; doc_no: string; doc_class: string; doc_date: string }>; locked_count: number; locked: string[]; totals: { debit: string; credit: string } };
type Result = { reposted: number; done: string[]; skipped: Array<{ doc_no: string; reason: string }>; before: { debit: string; credit: string }; after: { debit: string; credit: string }; same_totals: boolean };

/**
 * ลงบัญชีใหม่ให้เอกสารที่ลงไว้ก่อนแก้ (HANDOFF 126 · เจ้าของ 17/11/2569 "ลงบัญชีใหม่")
 * แผนกของบรรทัดเอกสาร/รายละเอียดเงินสดย่อยยังไม่อยู่ในใบสำคัญ → ลงใหม่ ยอดเงินเท่าเดิม (ระบบตรวจยอดรายบัญชีก่อนลงทุกใบ)
 */
export function RepostPanel() {
  const can = useCan('SET.LINK');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['repost-candidates'], queryFn: () => api.get<Cand>('/api/v1/docs/repost-candidates'), staleTime: 0 });
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    setAsk(false); setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>('/api/v1/docs/repost-batch', { ids: q.data!.rows.map((x) => x.id) });
      setRes(r);
      qc.invalidateQueries({ queryKey: ['repost-candidates'] }); qc.invalidateQueries({ queryKey: ['journal'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const c = q.data;
  const lockedList = c ? c.locked.slice(0, 12).join(', ') + (c.locked.length < c.locked_count || c.locked_count > 12 ? ' …' : '') : '';
  const more = c && c.rows.length < c.count ? ` (ลงใหม่ได้ครั้งละ ${c.rows.length.toLocaleString()} ใบ)` : '';
  return (
    <div className="tab-body">
      <p className="hint">เอกสารที่ลงบัญชีไว้ก่อน 17/11/2569: แผนกที่เลือกรายบรรทัด (เช่น เงินสดย่อย ฝ่าย 03/01/04) และรายละเอียดของบรรทัด ยังไม่อยู่ในใบสำคัญ — รายงานรายแผนกจึงไม่นับ
        · กดลงบัญชีใหม่ ระบบจะลงใบสำคัญเดิม (เลขที่เดิม) ใหม่ทีละใบ <b>เฉพาะใบที่ยอดเงินรายบัญชีเท่าเดิม</b> เปลี่ยนแค่แผนกและคำอธิบาย · ใบที่ยอดไม่ตรงหรืองวดปิดแล้วจะข้ามและแจ้ง · ทุกใบบันทึกประวัติการทำงาน</p>
      <ErrorBox error={err ?? q.error} />
      {c && <p>เข้าเงื่อนไข <b>{c.count.toLocaleString()}</b> ใบ{more} · ยอดรวมใบสำคัญทั้งบริษัท เดบิต <b className="num">{fmt(c.totals.debit)}</b> เครดิต <b className="num">{fmt(c.totals.credit)}</b></p>}
      {c && c.locked_count > 0 && <p className="notebox">อยู่ในงวดที่ปิดแล้ว {c.locked_count.toLocaleString()} ใบ — ลงใหม่ไม่ได้จนกว่าจะเปิดงวด (ไม่จำเป็น ถ้าไม่ต้องการรายงานรายแผนกของงวดนั้น): {lockedList}</p>}
      {c && c.rows.length > 0 && <div className="toolbar"><button className="primary" disabled={!can('edit') || busy} onClick={() => setAsk(true)} title={can('edit') ? '' : 'ต้องมีสิทธิ์แก้ไขการเชื่อมต่อบัญชี'}>{busy ? 'กำลังลงบัญชีใหม่…' : `ลงบัญชีใหม่ ${c.rows.length.toLocaleString()} ใบ`}</button></div>}
      {res && <div className={res.same_totals ? 'notebox ok-box' : 'errbox'} role="status">
        <b>ลงบัญชีใหม่แล้ว {res.reposted.toLocaleString()} ใบ{res.skipped.length ? ` · ข้าม ${res.skipped.length} ใบ` : ''}</b><br />
        ยอดรวมก่อน เดบิต {fmt(res.before.debit)} / เครดิต {fmt(res.before.credit)} · หลัง เดบิต {fmt(res.after.debit)} / เครดิต {fmt(res.after.credit)} · {res.same_totals ? 'เท่ากัน ✓' : 'ไม่เท่ากัน — แจ้งผู้ดูแลระบบ'}
        {res.skipped.length > 0 && <ul>{res.skipped.slice(0, 30).map((x) => <li key={x.doc_no}>{x.doc_no}: {x.reason}</li>)}</ul>}
      </div>}
      {c && <div className="table-wrap tall"><table className="grid">
        <thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>ชนิด</th></tr></thead>
        <tbody>
          {c.rows.map((r) => <tr key={r.id}><td><DateText v={r.doc_date} /></td><td><DocLink id={r.id} no={r.doc_no} cls={r.doc_class} /></td><td>{r.doc_class}</td></tr>)}
          {!c.rows.length && <tr><td colSpan={3} className="empty">ไม่มีเอกสารที่ต้องลงบัญชีใหม่ ✓</td></tr>}
        </tbody>
      </table></div>}
      {ask && <Confirm title="ลงบัญชีใหม่" text={`ลงบัญชีใหม่ ${c!.rows.length.toLocaleString()} ใบ — ยอดเงินรายบัญชีเท่าเดิม เปลี่ยนแผนกและคำอธิบายของบรรทัด (ใบที่ยอดไม่ตรงจะข้าม) ทำต่อหรือไม่?`} okText="ลงบัญชีใหม่" onClose={() => setAsk(false)} onOk={run} />}
    </div>
  );
}
