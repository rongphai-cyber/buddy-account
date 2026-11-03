import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { Confirm, ErrorBox, toast } from '../ui';

type Setup = { created: Record<'doc_types' | 'items' | 'warehouses' | 'customers', string[]>; existing: Record<'doc_types' | 'items' | 'warehouses' | 'customers', string[]>; hints: string[] };
const GROUP: Record<keyof Setup['created'], string> = { doc_types: 'ประเภทเอกสาร', items: 'รหัสรายได้', warehouses: 'คลังระหว่างทาง', customers: 'ลูกค้าแพลตฟอร์ม' };

/** คิดเงินเดือนที่ไหน (docs/17 D7 · B0.5): Buddy หรือ WTS-SOP — WTS-SOP = ปิดเมนูคิดเงินเดือนใน Buddy (SOP ส่งใบสำคัญเข้ามา) */
export function PayrollSource() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const edit = useCan('SET.CO')('edit');
  const q = useQuery({ queryKey: ['company-modules'], queryFn: () => api.get<{ payroll_source: 'buddy' | 'wts-sop' }>('/api/v1/company/modules') });
  const [ask, setAsk] = useState<'buddy' | 'wts-sop' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const cur = q.data?.payroll_source ?? 'buddy';
  const save = async (source: 'buddy' | 'wts-sop') => {
    setAsk(null); setErr(null);
    try {
      await api.put('/api/v1/company/payroll-source', { source });
      toast(source === 'wts-sop' ? 'บันทึกแล้ว — คิดเงินเดือนที่ WTS-SOP เมนูคิดเงินเดือนใน Buddy ถูกปิด' : 'บันทึกแล้ว — คิดเงินเดือนใน Buddy');
      await qc.invalidateQueries({ queryKey: ['company-modules'] }); await refresh();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="pay-source">
      <ErrorBox error={err} />
      <label className="inline"><b>คิดเงินเดือนที่</b>
        <select value={cur} disabled={!edit || !q.data} onChange={(e) => setAsk(e.target.value as 'buddy' | 'wts-sop')} aria-label="คิดเงินเดือนที่">
          <option value="buddy">Buddy Account (เมนูเงินเดือน)</option>
          <option value="wts-sop">WTS-SOP (ส่งใบสำคัญเงินเดือนเข้ามา)</option>
        </select>
      </label>
      <span className="muted small"> 1 บริษัทคิดเงินเดือนที่เดียว — เลือก WTS-SOP แล้วเมนูคิดเงินเดือนของบริษัทนี้ใน Buddy จะปิด (ข้อมูลเดิมไม่หาย)</span>
      {ask && ask !== cur && <Confirm title="เปลี่ยนที่คิดเงินเดือน" okText="เปลี่ยน" danger={ask === 'wts-sop'} onOk={() => save(ask)} onClose={() => setAsk(null)}
        text={ask === 'wts-sop' ? <>คิดเงินเดือนที่ <b>WTS-SOP</b>? เมนูคิดเงินเดือนของบริษัทนี้ใน Buddy จะปิดทันที — ใบสำคัญเงินเดือนให้ WTS-SOP ส่งเข้ามาด้วยกุญแจ API</> : <>กลับมาคิดเงินเดือนใน <b>Buddy Account</b>? เมนูเงินเดือนจะเปิด — ตรวจว่า WTS-SOP เลิกส่งใบสำคัญของบริษัทนี้แล้ว</>} />}
    </div>
  );
}

/** ปุ่ม "ตั้งค่าสำหรับ WTS-POS" (docs/17 ข้อ 5.7): สร้างชุดเริ่มต้นสำหรับร้านอาหารที่ยังไม่มี — กดซ้ำได้ */
export function WtsPosSetup() {
  const edit = useCan('SET.CO')('edit');
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Setup | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    setAsk(false); setErr(null); setBusy(true);
    try {
      const r = await api.post<Setup>('/api/v1/company/wts-pos-setup', {});
      setRes(r);
      const n = Object.values(r.created).reduce((s, x) => s + x.length, 0);
      toast(n ? `สร้างแล้ว ${n} รายการ` : 'มีครบแล้ว ไม่ต้องสร้างเพิ่ม');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <>
      <h2 className="section-title">เชื่อมระบบ WTS Solutions</h2>
      <div className="card">
        <p className="hint">ใช้กับ WTS-POS (หน้าร้าน ครัวกลาง แฟรนไชส์) — สร้างชุดเริ่มต้นที่ยังไม่มี: ประเภทเอกสารเบิกใช้ OUR ตามสูตร · OUW ของเสีย · OUS อาหารพนักงาน · OUQ ชิมคุณภาพ ·
          รหัสรายได้ POS-FOOD POS-BEV POS-SVC · คลังระหว่างทางของทุกสาขา (TR…) · ลูกค้าแพลตฟอร์ม Grab LINE MAN foodpanda ShopeeFood Robinhood · กดซ้ำได้ (ข้ามที่มีแล้ว) · ระบบอื่นส่งเอกสารเข้ามาด้วยกุญแจ API (เริ่มระบบ › กุญแจ API)</p>
        <ErrorBox error={err} />
        <PayrollSource />
        {edit && <div className="theme-acts"><button type="button" className="primary" disabled={busy} onClick={() => setAsk(true)}>ตั้งค่าสำหรับ WTS-POS</button></div>}
        {res && <div className="wts-result">
          <table className="grid"><thead><tr><th>กลุ่ม</th><th>สร้างใหม่</th><th>มีอยู่แล้ว</th></tr></thead>
            <tbody>{(Object.keys(GROUP) as Array<keyof Setup['created']>).map((k) => <tr key={k}><td>{GROUP[k]}</td><td className="mono">{res.created[k].join(' ') || '—'}</td><td className="mono muted">{res.existing[k].join(' ') || '—'}</td></tr>)}</tbody></table>
          <ul className="hint">{res.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>}
      </div>
      {ask && <Confirm title="ตั้งค่าสำหรับ WTS-POS" okText="สร้าง" onOk={run} onClose={() => setAsk(false)}
        text={<>สร้างประเภทเอกสาร รหัสรายได้ คลังระหว่างทาง และลูกค้าแพลตฟอร์มที่ยังไม่มีในบริษัทนี้? รายการที่มีอยู่แล้วไม่ถูกแก้</>} />}
    </>
  );
}
