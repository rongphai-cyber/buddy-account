import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fmt } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, DateInput, DateText, ErrorBox, Field, Modal, PageHead, Pill, toast, toastError } from '../../ui';

interface Status {
  years: Array<{ id: string; code: string; start: string; end: string; status: string; closed_at: string | null }>;
  fiscal_year: { id: string; code: string; start: string; end: string; status: string; closed_at: string | null };
  periodic: boolean; unlocked_periods: number;
  inventory: Array<{ account_id: string; account_no: string; name: string; opening: string; ledger_end: string; closing: string | null }>;
  checks: Array<{ key: string; label: string; ok: boolean; block: boolean; detail: string }>;
  next_year: { id: string | null; code: string; start: string };
}

/**
 * ประมวลผลสิ้นปี (คู่มือบทที่ 22 S-YE-01..04) — ทำแบบใหม่: ไม่ลบรายการปีเก่า ยอดยกมาและกำไรสะสมคำนวณสดจากใบสำคัญ
 * ปิดปี = ตรวจความพร้อม → (Periodic) ใบสำคัญปิดสินค้าคงเหลือ → พิมพ์ YES → ล็อคทุกงวด + สร้างรอบบัญชีปีถัดไป · เปิดปีกลับได้
 */
export function YearEndPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const can = useCan('OT.YE');
  const [fyId, setFyId] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['year-end', fyId], queryFn: () => api.get<Status>('/api/v1/gl/year-end', { fiscal_year_id: fyId }), staleTime: 0 });
  const [confirm, setConfirm] = useState<{ text: string; start: string } | null>(null);
  const [askReopen, setAskReopen] = useState(false);
  const [askInv, setAskInv] = useState(false);
  const x = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['year-end'] }); qc.invalidateQueries({ queryKey: ['periods'] }); };
  const close = async () => {
    if (!x || !confirm) return;
    try {
      const r = await api.post<{ closed: string }>('/api/v1/gl/year-end/close', { fiscal_year_id: x.fiscal_year.id, confirm: confirm.text, next_start: x.next_year.id ? undefined : confirm.start });
      toast(`ประมวลผลสิ้นปี ${r.closed} แล้ว — ล็อคทุกงวดและเริ่มปีใหม่ได้ทันที`); setConfirm(null); refresh();
    } catch (e) { toastError(e); }
  };
  const blocked = x?.checks.some((c) => c.block && !c.ok);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="อื่น ๆ › ประมวลผลสิ้นปี" title="ประมวลผลสิ้นปี" lead="Buddy ไม่ลบรายการของปีที่ปิด — ยอดยกมาของสินทรัพย์ หนี้สิน ทุน และกำไรสะสมคำนวณจากใบสำคัญอัตโนมัติ การปิดปีจะล็อคทุกงวดของปีนั้น (แก้ไขย้อนหลังไม่ได้) และสร้างรอบบัญชีปีถัดไป" />
      <div className="toolbar">
        <label>ปีที่จะปิด <select value={x?.fiscal_year.id ?? ''} onChange={(e) => setFyId(e.target.value)}>{x?.years.map((y) => <option key={y.id} value={y.id}>{y.code} ({y.status === 'C' ? 'ปิดแล้ว' : 'เปิด'})</option>)}</select></label>
        {x && <span className="muted small">รอบบัญชี <DateText v={x.fiscal_year.start} /> – <DateText v={x.fiscal_year.end} /></span>}
        {x?.fiscal_year.status === 'C' ? <Pill tone="d">ปิดแล้ว {x.fiscal_year.closed_at ? new Date(x.fiscal_year.closed_at).toLocaleDateString('th-TH') : ''}</Pill> : x && <Pill tone="n">เปิดอยู่ · งวดที่ยังไม่ล็อค {x.unlocked_periods}</Pill>}
      </div>
      <ErrorBox error={q.error} />
      {x && <>
        <h3 className="small">ตรวจความพร้อมก่อนปิดปี</h3>
        <table className="grid" style={{ maxWidth: 900 }}><tbody>
          {x.checks.map((c) => <tr key={c.key}><td style={{ width: 36 }} className="c">{c.ok ? '✅' : c.block ? '⛔' : '⚠️'}</td><td>{c.label}{!c.ok && !c.block && <span className="muted small"> (ปิดได้ แต่ควรตรวจ)</span>}</td><td className="small muted">{c.detail}</td></tr>)}
          <tr><td className="c">💾</td><td>สำรองข้อมูลก่อนปิดปี</td><td className="small muted">ปิดปีแล้วเปิดกลับได้ (ไม่มีข้อมูลถูกลบ) แต่ควรสำรองข้อมูลเก็บไว้ตามแนวทาง Express</td></tr>
        </tbody></table>
        {x.periodic && <>
          <h3 className="small">ปิดบัญชีสินค้าคงเหลือ (Periodic) — S-YE-01</h3>
          <table className="grid" style={{ maxWidth: 900 }}>
            <thead><tr><th>บัญชี</th><th className="r">ยอดต้นปี (แยกประเภท)</th><th className="r">ยอดปลายปี (ยืนยันแล้ว)</th></tr></thead>
            <tbody>{x.inventory.map((i) => <tr key={i.account_id}><td className="mono">{i.account_no} <span className="muted">{i.name}</span></td><td className="r num">{fmt(i.opening)}</td><td className="r num">{i.closing === null ? <span className="bad">ยังไม่ยืนยัน</span> : fmt(i.closing)}</td></tr>)}</tbody>
          </table>
          <div className="toolbar"><button disabled={!can('add') || x.fiscal_year.status === 'C'} onClick={() => setAskInv(true)}>ลงใบสำคัญปิดสินค้า (Dr ต้นทุนขาย / Cr สินค้าต้นปี · Dr สินค้าปลายปี / Cr ต้นทุนขาย)</button>
            <button onClick={() => nav('/gl/inventory')}>บัญชีสินค้าคงเหลือ…</button></div>
        </>}
        <div className="toolbar" style={{ marginTop: 16 }}>
          {x.fiscal_year.status === 'O'
            ? <button className="primary" disabled={!can('edit') || blocked} onClick={() => setConfirm({ text: '', start: x.next_year.start })} title={blocked ? 'แก้รายการที่มี ⛔ ก่อน' : ''}>ประมวลผลสิ้นปี {x.fiscal_year.code}…</button>
            : <button disabled={!can('cancel')} onClick={() => setAskReopen(true)}>เปิดปี {x.fiscal_year.code} กลับ</button>}
          <span className="muted small">ปีถัดไป: {x.next_year.id ? `${x.next_year.code} (มีรอบบัญชีแล้ว)` : `${x.next_year.code} จะสร้างให้อัตโนมัติ`}</span>
        </div>
      </>}
      {confirm && x && <Modal title="ปิดประมวลผลสิ้นปี" size="confirm" onClose={() => setConfirm(null)} footer={<><button onClick={() => setConfirm(null)}>ยกเลิก</button><button className="danger" onClick={close} disabled={confirm.text.trim().toUpperCase() !== 'YES'}>ตกลง</button></>}>
        <p><b>*** คำเตือน ***</b> ควรสำรองข้อมูลเก็บไว้ก่อนประมวลผลสิ้นปี · ปี {x.fiscal_year.code} จะถูกล็อคทุกงวด — แก้ไขรายการย้อนหลังไม่ได้จนกว่าจะเปิดปีกลับ</p>
        {!x.next_year.id && <Field label="รอบบัญชีปีใหม่เริ่มวันที่" hint="สร้าง 12 งวดสิ้นเดือนอัตโนมัติ — แก้ภายหลังได้ที่ เริ่มระบบ › รอบบัญชี"><DateInput value={confirm.start} onChange={(v) => setConfirm({ ...confirm, start: v })} /></Field>}
        <Field label="ถ้าสำรองข้อมูลแล้ว ให้ป้อน YES เพื่อยืนยัน" req><input autoFocus value={confirm.text} onChange={(e) => setConfirm({ ...confirm, text: e.target.value })} /></Field>
      </Modal>}
      {askReopen && x && <Confirm title="เปิดปีกลับ" text={`ปลดล็อคทุกงวดของปี ${x.fiscal_year.code} และตั้งสถานะเป็นเปิด?`} onClose={() => setAskReopen(false)}
        onOk={() => api.post('/api/v1/gl/year-end/reopen', { fiscal_year_id: x.fiscal_year.id }).then(() => { toast('เปิดปีกลับแล้ว'); setAskReopen(false); refresh(); }).catch((e) => { setAskReopen(false); toastError(e); })} />}
      {askInv && x && <Confirm title="ลงใบสำคัญปิดสินค้าคงเหลือ" text={`ลงใบสำคัญ 2 ใบ ลงวันที่สิ้นปี (ปิดสินค้าต้นปี / ยกสินค้าปลายปี) ตามยอดในตาราง?`} onClose={() => setAskInv(false)}
        onOk={() => api.post<{ vouchers: string[] }>('/api/v1/gl/year-end/inventory-jv', { fiscal_year_id: x.fiscal_year.id }).then((r) => { toast(`ลงใบสำคัญ ${r.vouchers.join(', ')} แล้ว`); setAskInv(false); refresh(); }).catch((e) => { setAskInv(false); toastError(e); })} />}
    </div>
  );
}
