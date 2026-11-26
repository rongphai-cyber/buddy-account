import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { Confirm, DateText, ErrorBox, KeyHints, PageHead, Pill, useHotkeys } from '../../ui';

type Sample = { label: string | null; before: string; after: string };
type Column = { table: string; column: string; table_th: string; column_th: string; count: number; samples: Sample[] };
type Year = { id?: string; code: string; new_code: string; start_date: string; end_date: string; new_start: string; new_end: string; status?: string; conflict?: string | null };
type Scan = { total: number; columns: Column[]; fiscal_years: Year[]; conflicts: string[] };
type Result = { total: number; changed: Array<Omit<Column, 'samples'>>; samples: Column[]; fiscal_years: Year[]; check: { accounts: number; same: boolean; before: { debit: string; credit: string }; after: { debit: string; credit: string } } };

/** วันที่/เวลาที่เก็บ → แสดงตามระบบปีของบริษัท (เวลาแสดงเฉพาะวันที่) */
const D = ({ v }: { v: string }) => <DateText v={v.slice(0, 10)} />;
const n = (x: number) => x.toLocaleString();

/**
 * ตรวจวันที่ปีผิดระบบ (HANDOFF 183 · เจ้าของ 24/11/2569 "แก้ไขเรื่องนี้ก่อน")
 * ก่อนรุ่น 182 บริษัทที่ใช้ ค.ศ. พิมพ์ปี พ.ศ. แล้วเก็บเป็นปี ค.ศ. นั้น (17/07/2566 → ค.ศ. 2566) — ตรวจทุกข้อมูลของบริษัท แล้วลบ 543 ปีให้ เมื่อผู้ดูแลระบบยืนยัน
 */
export function YearFixPage() {
  const nav = useNavigate();
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['year-fix'], queryFn: () => api.get<Scan>('/api/v1/tools/year-fix'), staleTime: 0, retry: false });
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const s = q.data;
  const isAdmin = !!me?.user.is_admin;
  const canFix = !!s && s.total > 0 && !s.conflicts.length && isAdmin && !busy;
  const rescan = () => { setErr(null); q.refetch(); };
  const run = async () => {
    setAsk(false); setBusy(true); setErr(null);
    try {
      setRes(await api.post<Result>('/api/v1/tools/year-fix', { expect_total: s!.total }));
      qc.invalidateQueries();
    } catch (e) { setErr(e); q.refetch(); } finally { setBusy(false); }
  };
  useHotkeys({ Escape: ask ? undefined : () => nav(-1), F5: rescan }, [ask]);
  const example = s?.columns[0]?.samples[0];
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เริ่มระบบ › เครื่องมือ" title="ตรวจวันที่ปีผิดระบบ (พ.ศ./ค.ศ.)"
        lead={<>ตรวจว่ามีวันที่ที่บันทึกด้วยปีผิดระบบหรือไม่ (เช่น บริษัทใช้ ค.ศ. แต่วันที่เก็บเป็นปี 2566 — เลื่อนไป 543 ปี) · ตรวจทุกข้อมูลของบริษัทนี้ (เอกสาร ใบสำคัญ ปีบัญชี/งวด ที่อยู่ ทะเบียนต่าง ๆ) <b>ไม่ว่าบันทึกเมื่อใดหรือมาจากทางไหน</b> — คีย์ที่หน้าจอ โปรแกรมอื่นที่ส่งเข้ามา (WTS-POS · WTS-Living · WTS-HR) หรือนำเข้า · พบแล้วแก้ให้โดยลบ 543 ปี เมื่อผู้ดูแลระบบยืนยัน</>} />
      <p className="notebox small">พนักงานพิมพ์ปีผิดระบบที่หน้าจอ (เช่น บริษัท ค.ศ. พิมพ์ 02/04/2568) ตั้งแต่รุ่น 2569.11.24-4 ระบบแปลงเป็นปีที่ถูกให้ทันทีก่อนบันทึก (→ 02/04/2025) จึงไม่ค้างในข้อมูลและไม่แสดงในหน้านี้ · ที่พบในหน้านี้ = วันที่ที่ยังผิดอยู่ในข้อมูลจริง ต้องแก้ · ไม่ตรวจปีที่พิมพ์ผิดแบบอื่น (เช่น 2567 แทน 2568) — ตรวจจากรายงานตามช่วงวันที่</p>
      <div className="toolbar">
        <button className="primary" disabled={!canFix} onClick={() => setAsk(true)}
          title={!isAdmin ? 'เฉพาะผู้ดูแลระบบ' : s?.conflicts.length ? 'แก้ปัญหาที่แจ้งด้านล่างก่อน' : s && !s.total ? 'ไม่มีวันที่ต้องแก้' : 'ลบ 543 ปีจากวันที่ที่พบทั้งหมด'}>
          {busy ? 'กำลังแก้…' : `แก้วันที่ทั้งหมด${s?.total ? ` (${n(s.total)} รายการ)` : ''}`}
        </button>
        <button onClick={rescan} disabled={q.isFetching || busy}>{q.isFetching ? 'กำลังตรวจ…' : 'ตรวจใหม่'} <kbd>F5</kbd></button>
        <button onClick={() => nav(-1)}>กลับ <kbd>Esc</kbd></button>
      </div>
      {!isAdmin && <p className="notebox">เฉพาะผู้ดูแลระบบของบริษัทใช้หน้านี้ได้ — ให้ผู้ดูแลระบบเป็นผู้ตรวจ/แก้</p>}
      <ErrorBox error={err ?? q.error} />

      {res && <div className={res.check.same ? 'notebox ok-box' : 'errbox'} role="status">
        <b>แก้วันที่แล้ว {n(res.total)} รายการ (ลบ 543 ปี)</b>
        {res.fiscal_years.length > 0 && <> · ปีบัญชี {res.fiscal_years.map((y) => `${y.code} → ${y.new_code}`).join(', ')}</>}<br />
        ตรวจงบทดลองรายบัญชีทุกวันที่ {n(res.check.accounts)} บัญชี: ก่อนแก้ เดบิต <span className="num">{fmt(res.check.before.debit)}</span> เครดิต <span className="num">{fmt(res.check.before.credit)}</span> ·
        หลังแก้ เดบิต <span className="num">{fmt(res.check.after.debit)}</span> เครดิต <span className="num">{fmt(res.check.after.credit)}</span> — {res.check.same ? 'ตรงทุกบัญชี ✓ (ยอดเงินไม่เปลี่ยน เปลี่ยนเฉพาะวันที่)' : 'ไม่ตรง'}<br />
        บันทึกไว้ที่ <a href="/tools/activity-log" onClick={(e) => { e.preventDefault(); nav('/tools/activity-log'); }}>แฟ้มบันทึกเหตุการณ์ทำงาน</a> (FIX_YEAR) ·
        งวดที่ปิดอยู่ยังปิดเหมือนเดิม
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>ข้อมูล</th><th>ช่อง</th><th className="r">แก้แล้ว</th><th>ตัวอย่าง (เดิม → ใหม่)</th></tr></thead>
          <tbody>{res.samples.map((c) => <tr key={`${c.table}.${c.column}`}><td>{c.table_th}</td><td>{c.column_th}</td><td className="r num">{n(c.count)}</td>
            <td>{c.samples.slice(0, 2).map((x, i) => <span key={i} className="nowrap">{i > 0 && ' · '}{x.label ? `${x.label}: ` : ''}<D v={x.before} /> → <D v={x.after} /></span>)}</td></tr>)}</tbody>
        </table></div>
      </div>}

      {s && !res && (s.total === 0
        ? <p className="notebox ok-box" role="status">ไม่พบวันที่ปีผิดระบบในบริษัทนี้ ✓ — ไม่ต้องแก้</p>
        : <p className="notebox" role="status">พบวันที่ปีผิดระบบ <b>{n(s.total)}</b> รายการ ใน {n(s.columns.length)} ช่องข้อมูล
          {example && <> — เช่น <D v={example.before} /> ควรเป็น <D v={example.after} /></>} · กด "แก้วันที่ทั้งหมด" เพื่อลบ 543 ปี (ตรวจยอดเงินก่อน/หลังให้ และบันทึกเหตุการณ์)</p>)}

      {s && s.conflicts.length > 0 && <div className="errbox" role="alert"><b>ยังแก้ไม่ได้ — แก้เรื่องต่อไปนี้ก่อน แล้วกดตรวจใหม่</b>
        <ul>{s.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}

      {s && s.fiscal_years.length > 0 && <>
        <h3>ปีบัญชีที่วันที่ผิด</h3>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>รหัสปี (เดิม → ใหม่)</th><th>ช่วงวันที่เดิม</th><th>ช่วงวันที่หลังแก้</th><th>สถานะ</th><th>ผลตรวจ</th></tr></thead>
          <tbody>{s.fiscal_years.map((y) => <tr key={y.id ?? y.code}>
            <td className="mono">{y.code} → {y.new_code}</td><td><D v={y.start_date} /> – <D v={y.end_date} /></td><td><D v={y.new_start} /> – <D v={y.new_end} /></td>
            <td>{y.status === 'C' ? <Pill tone="c">ประมวลผลสิ้นปีแล้ว</Pill> : <Pill tone="n">เปิดอยู่</Pill>}</td>
            <td>{y.conflict ? <Pill tone="x">ซ้อน/ซ้ำ — ดูด้านบน</Pill> : <Pill tone="n">ย้ายได้</Pill>}</td></tr>)}</tbody>
        </table></div>
      </>}

      {s && s.columns.length > 0 && !res && <>
        <h3>ข้อมูลที่พบ</h3>
        <div className="table-wrap tall"><table className="grid">
          <thead><tr><th>ข้อมูล</th><th>ช่อง</th><th className="r">จำนวน</th><th>ตัวอย่าง (เลขที่/รหัส: วันที่เก็บไว้ → หลังแก้)</th></tr></thead>
          <tbody>{s.columns.map((c) => <tr key={`${c.table}.${c.column}`} title={`${c.table}.${c.column}`}>
            <td>{c.table_th}</td><td>{c.column_th}</td><td className="r num">{n(c.count)}</td>
            <td>{c.samples.slice(0, 3).map((x, i) => <span key={i} className="nowrap">{i > 0 && ' · '}{x.label ? `${x.label}: ` : ''}<D v={x.before} /> → <D v={x.after} /></span>)}{c.count > 3 && ' …'}</td></tr>)}</tbody>
        </table></div>
      </>}
      <KeyHints keys={[['F5', 'ตรวจใหม่'], ['Esc', 'กลับ']]} />

      {ask && s && <Confirm title="แก้วันที่ปีผิดระบบ" okText={`แก้ ${n(s.total)} รายการ`} onOk={run} onClose={() => setAsk(false)}
        text={<>ลบ 543 ปีจากวันที่ <b>{n(s.total)}</b> รายการตามตาราง{example && <> (เช่น <D v={example.before} /> → <D v={example.after} />)</>}
          {s.fiscal_years.length > 0 && <> · ปีบัญชี {s.fiscal_years.map((y) => `${y.code} → ${y.new_code}`).join(', ')}</>}</>}>
        <ul>
          {s.columns.map((c) => <li key={`${c.table}.${c.column}`}>{c.table_th} › {c.column_th}: {n(c.count)} รายการ</li>)}
        </ul>
        <p>เปลี่ยนเฉพาะวันที่ ยอดเงินไม่เปลี่ยน — ระบบตรวจงบทดลองรายบัญชีก่อน/หลัง ไม่เท่า = ยกเลิกทั้งหมด · งวดที่ปิดอยู่ยังปิด · ทุกช่องที่แก้บันทึกในแฟ้มบันทึกเหตุการณ์ทำงาน (FIX_YEAR) · แนะนำสำรองข้อมูลก่อน (อื่น ๆ › สำรองข้อมูล)</p>
      </Confirm>}
    </div>
  );
}
