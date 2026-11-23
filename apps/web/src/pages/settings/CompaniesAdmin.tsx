import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { ErrorBox, Field, Modal, Pill, toast } from '../../ui';

type Row = { id: string; code: string; name_th: string; tenant_code: string | null; deleted_at: string | null; deleted_by: string | null; doc_count: number; journal_count: number; last_date: string | null; current: boolean };

/**
 * บริษัททั้งหมดของลูกค้า — ลบ/กู้คืนบริษัท (HANDOFF 175 — เจ้าของ 23/11/2569 "กรณีสร้างบริษัทผิด หรือต้องการลบบริษัทที่ไม่ใช้แล้ว … (Admin เท่านั้นที่ทำได้)")
 * ผู้ดูแลระบบของลูกค้า/เจ้าหน้าที่ผู้ให้บริการ · ลบ = ซ่อนจากตัวเลือกบริษัท (ไม่ลบข้อมูลจริง) กู้คืนได้ · ก่อนลบแสดงจำนวนเอกสาร/วันที่ล่าสุด สำรองข้อมูลก่อนได้
 * ยืนยันด้วยรหัสบริษัท + รหัสยืนยันตัวตน (ถ้าเปิดสองขั้น) · บริษัทที่เลือกอยู่และบริษัทสุดท้ายลบไม่ได้
 */
export function CompaniesAdmin() {
  const { me, select, refresh } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ys = me?.company?.year_system ?? 'B';
  const q = useQuery({ queryKey: ['companies-manage'], queryFn: () => api.get<{ rows: Row[] }>('/api/v1/companies/manage') });
  const [del, setDel] = useState<Row | null>(null);
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rows = q.data?.rows ?? [];
  const active = rows.filter((r) => !r.deleted_at), gone = rows.filter((r) => r.deleted_at);
  const reload = async () => { await qc.invalidateQueries({ queryKey: ['companies-manage'] }); await refresh(); };
  const doDelete = async () => {
    if (!del) return;
    setBusy(true); setErr(null);
    try { await api.post(`/api/v1/companies/${del.id}/delete`, { confirm_code: code, totp_code: totp || null }); toast(`ลบบริษัท ${del.code} แล้ว — กู้คืนได้ที่รายการบริษัทที่ลบแล้ว`); setDel(null); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const restore = async (r: Row) => {
    try { await api.post(`/api/v1/companies/${r.id}/restore`, {}); toast(`กู้คืนบริษัท ${r.code} แล้ว`); await reload(); } catch (e) { setErr(e); }
  };
  /** สำรองข้อมูลก่อนลบ: เปิดบริษัทนั้นแล้วไปหน้าสำรองข้อมูล (กลับมาลบจากบริษัทอื่น) */
  const backup = (r: Row) => void select({ company_id: r.id }).then(() => nav('/tools/backup'));
  const head = <tr><th style={{ width: 150 }}>รหัสบริษัท</th><th>ชื่อบริษัท</th>{me?.user.is_platform && <th style={{ width: 110 }}>ลูกค้า</th>}<th className="r" style={{ width: 110 }}>เอกสาร</th><th className="r" style={{ width: 110 }}>ใบสำคัญ</th><th style={{ width: 130 }}>เอกสารล่าสุด</th><th style={{ width: 240 }}></th></tr>;
  return (
    <div className="card">
      <p className="hint">บริษัทที่สร้างผิดหรือไม่ใช้แล้ว: <b>ลบ</b> = ซ่อนจากตัวเลือกบริษัทและไม่นับในจำนวนบริษัทของลูกค้า — ข้อมูลยังอยู่ กู้คืนได้ที่ "บริษัทที่ลบแล้ว" · ลบบริษัทที่เลือกอยู่ไม่ได้ (เปลี่ยนบริษัทก่อน) · ลบบริษัทสุดท้ายไม่ได้ · แนะนำ <b>สำรองข้อมูลก่อน</b></p>
      <ErrorBox error={err ?? q.error} />
      <div className="table-wrap"><table className="grid">
        <thead>{head}</thead>
        <tbody>{active.map((r) => <tr key={r.id}>
          <td className="mono">{r.code} {r.current && <Pill tone="n">ใช้อยู่</Pill>}</td><td>{r.name_th}</td>{me?.user.is_platform && <td className="mono small">{r.tenant_code}</td>}
          <td className="r num">{r.doc_count.toLocaleString()}</td><td className="r num">{r.journal_count.toLocaleString()}</td><td>{r.last_date ? formatDate(r.last_date, ys) : <span className="muted">ไม่มี</span>}</td>
          <td>{!r.current && <><button type="button" onClick={() => backup(r)} title="เปิดบริษัทนี้แล้วไปหน้าสำรองข้อมูล">สำรองข้อมูลก่อน</button>{' '}
            <button type="button" className="danger" disabled={active.length < 2} title={active.length < 2 ? 'ลบบริษัทสุดท้ายไม่ได้' : undefined} onClick={() => { setDel(r); setCode(''); setTotp(''); setErr(null); }}>ลบบริษัท</button></>}</td>
        </tr>)}</tbody>
      </table></div>
      <h3 style={{ marginTop: 18 }}>บริษัทที่ลบแล้ว {gone.length > 0 && <span className="muted small">({gone.length})</span>}</h3>
      {gone.length === 0 ? <p className="muted">ไม่มี</p> : <div className="table-wrap"><table className="grid">
        <thead>{head}</thead>
        <tbody>{gone.map((r) => <tr key={r.id} className="muted-row">
          <td className="mono">{r.code}</td><td>{r.name_th}<div className="muted small">ลบเมื่อ {formatDate(String(r.deleted_at).slice(0, 10), ys)}{r.deleted_by ? ` โดย ${r.deleted_by}` : ''}</div></td>{me?.user.is_platform && <td className="mono small">{r.tenant_code}</td>}
          <td className="r num">{r.doc_count.toLocaleString()}</td><td className="r num">{r.journal_count.toLocaleString()}</td><td>{r.last_date ? formatDate(r.last_date, ys) : <span className="muted">ไม่มี</span>}</td>
          <td><button type="button" onClick={() => void restore(r)}>กู้คืน</button></td>
        </tr>)}</tbody>
      </table></div>}
      {del && <Modal title={`ลบบริษัท ${del.code}`} size="confirm" onClose={() => setDel(null)} footer={<><button onClick={() => setDel(null)}>ยกเลิก</button>
        <button className="danger" disabled={busy || code.trim().toUpperCase() !== del.code.toUpperCase()} onClick={() => void doDelete()}>ลบบริษัท</button></>}>
        <p><b>{del.code} · {del.name_th}</b></p>
        <p>มีเอกสาร <b>{del.doc_count.toLocaleString()}</b> ฉบับ · ใบสำคัญ <b>{del.journal_count.toLocaleString()}</b> ใบ · เอกสารล่าสุด <b>{del.last_date ? formatDate(del.last_date, ys) : 'ไม่มี'}</b></p>
        <p className="hint">ลบแล้วบริษัทจะหายจากตัวเลือกบริษัทของทุกคน — ข้อมูลไม่ถูกลบ กู้คืนได้ที่ "บริษัทที่ลบแล้ว" · ถ้ายังไม่ได้สำรองข้อมูล กด "สำรองข้อมูลก่อน" ในรายการ</p>
        <Field label={`พิมพ์รหัสบริษัท ${del.code} เพื่อยืนยัน`} req><input value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="รหัสบริษัทเพื่อยืนยัน" /></Field>
        <Field label="รหัสยืนยันตัวตน 6 หลัก" hint="เฉพาะบัญชีที่เปิดยืนยันสองขั้น (จากแอปยืนยันตัวตน)"><input value={totp} inputMode="numeric" maxLength={11} onChange={(e) => setTotp(e.target.value)} aria-label="รหัสยืนยันตัวตน" /></Field>
        <ErrorBox error={err} />
      </Modal>}
    </div>
  );
}
