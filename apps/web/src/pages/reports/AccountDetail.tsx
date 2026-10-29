import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmt, formatDate, todayIso } from '@buddy/core';
import { api, type Department } from '../../api';
import { useSession } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { cx, DateInput, downloadCsv, ErrorBox, Field, Money, PageHead } from '../../ui';

interface Row { id: string; account_no: string; name_th: string; depth: number; is_control: boolean; status: string; closing: string; movement: string }
interface Detail { account: { id: string; account_no: string; name_th: string }; as_of: string; from: string; rows: Row[]; leaf_count: number; total_closing: string; total_movement: string }

/** รายละเอียดประกอบ (รายงาน 5.5, คู่มือบทที่ 7 R-GL-01) — บัญชีย่อยทั้งหมดใต้บัญชีที่เลือก พร้อมยอดคงเหลือและยอดเคลื่อนไหว */
export function AccountDetailPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [acc, setAcc] = useState<string | null>(sp.get('account_id'));
  const [asOf, setAsOf] = useState(sp.get('as_of') ?? me?.work_date ?? todayIso());
  const [dept, setDept] = useState('');
  const [movement, setMovement] = useState<'ytd' | 'ptd'>('ytd');
  const [zero, setZero] = useState(true);
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const q = useQuery({ enabled: !!acc && !!asOf, queryKey: ['account-detail', acc, asOf, dept, movement, zero], queryFn: () => api.get<Detail>('/api/v1/reports/account-detail', { account_id: acc, as_of: asOf, department_id: dept || undefined, movement, zero: zero ? '1' : '0' }) });
  const ys = me?.company?.year_system ?? 'B';
  const r = q.data;
  const deptName = depts.data?.find((x) => x.id === dept);
  return (
    <div className="page" data-tone="reports">
      <PageHead eyebrow="รายงาน › รายละเอียดประกอบ" title={r ? `รายละเอียดประกอบบัญชี ${r.account.account_no} ${r.account.name_th}` : 'รายละเอียดประกอบ'}
        lead={r ? `ณ วันที่ ${formatDate(r.as_of, ys)} · แผนก ${deptName ? `${deptName.code} ${deptName.name_th}` : '* (ทุกแผนก)'} · ยอดเคลื่อนไหว${movement === 'ytd' ? 'ตั้งแต่ต้นปี' : 'เฉพาะงวดนี้'} (${formatDate(r.from, ys)} – ${formatDate(r.as_of, ys)})` : 'เลือกบัญชี (บัญชีคุมจะแสดงบัญชีย่อยทั้งหมด) — ใช้ตรวจก่อนลบบัญชีคุม หรือทำรายละเอียดประกอบงบ'}
        actions={<>
          <button disabled={!r} onClick={() => window.print()}>พิมพ์</button>
          <button disabled={!r} onClick={() => downloadCsv(`รายละเอียดประกอบ_${r!.account.account_no}_${r!.as_of}`, ['เลขที่บัญชี', 'ชื่อบัญชี', 'ยอดคงเหลือ', 'ยอดเคลื่อนไหว'], r!.rows.map((x) => [x.account_no, x.name_th, x.closing, x.movement]))}>ส่งออก Excel</button>
        </>} />
      <div className="filters no-print">
        <Field label="บัญชี"><AccountCell value={acc} postableOnly={false} autoFocus={!acc} onChange={(a) => { setAcc(a?.id ?? null); if (a) setSp({ account_id: a.id, as_of: asOf }, { replace: true }); }} /></Field>
        <Field label="ณ วันที่"><DateInput value={asOf} onChange={setAsOf} /></Field>
        <Field label="แผนก"><select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">* ทุกแผนก</option>{depts.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
        <Field label="ยอดเคลื่อนไหว"><select value={movement} onChange={(e) => setMovement(e.target.value as 'ytd' | 'ptd')}><option value="ytd">ตั้งแต่ต้นปี</option><option value="ptd">เฉพาะงวดนี้</option></select></Field>
        <label className="inline"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> แสดงบัญชีที่ยอดเป็นศูนย์</label>
      </div>
      <ErrorBox error={q.error} />
      {r && (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th style={{ width: 160 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r" style={{ width: 180 }}>ยอดคงเหลือ</th><th className="r" style={{ width: 180 }}>ยอดเคลื่อนไหว</th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.id} className={cx('row-open', x.is_control && 'ctl', x.status !== 'A' && 'void')} onClick={() => nav(`/reports/ledger?account_id=${x.id}&from=${r.from}&to=${r.as_of}`)}>
                  <td className="mono" style={{ paddingLeft: 8 + x.depth * 14 }}>{x.account_no}</td>
                  <td>{x.is_control ? <b>{x.name_th}</b> : x.name_th}{x.status !== 'A' && <span className="muted"> (เลิกใช้)</span>}</td>
                  <td className="r"><Money v={x.closing} paren /></td><td className="r"><Money v={x.movement} paren blankZero /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>รวม {r.leaf_count.toLocaleString()} บัญชี</td><td className="r num">{fmt(r.total_closing, { paren: true })}</td><td className="r num">{fmt(r.total_movement, { paren: true })}</td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="hint no-print">ยอดแสดงตามด้านปกติของบัญชี (สินทรัพย์/ค่าใช้จ่ายเป็นบวกเมื่อเดบิต, หนี้สิน/ทุน/รายได้เป็นบวกเมื่อเครดิต) · คลิกบัญชีเพื่อดูแยกประเภท</p>
    </div>
  );
}
