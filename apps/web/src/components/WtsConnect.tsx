import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { Confirm, ErrorBox, toast } from '../ui';

type Setup = { created: Record<'doc_types' | 'items' | 'warehouses' | 'customers', string[]>; existing: Record<'doc_types' | 'items' | 'warehouses' | 'customers', string[]>; hints: string[] };
const GROUP: Record<keyof Setup['created'], string> = { doc_types: 'ประเภทเอกสาร', items: 'รหัสรายได้', warehouses: 'คลังระหว่างทาง', customers: 'ลูกค้าแพลตฟอร์ม' };

/** คิดเงินเดือนที่ไหน (docs/17 D7 · B0.5): Buddy หรือ WTS-HR — WTS-HR = ปิดเมนูคิดเงินเดือนใน Buddy (SOP ส่งใบสำคัญเข้ามา) */
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
      toast(source === 'wts-sop' ? 'บันทึกแล้ว — คิดเงินเดือนที่ WTS-HR เมนูคิดเงินเดือนใน Buddy ถูกปิด' : 'บันทึกแล้ว — คิดเงินเดือนใน Buddy');
      await qc.invalidateQueries({ queryKey: ['company-modules'] }); await refresh();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="pay-source">
      <ErrorBox error={err} />
      <label className="inline"><b>คิดเงินเดือนที่</b>
        <select value={cur} disabled={!edit || !q.data} onChange={(e) => setAsk(e.target.value as 'buddy' | 'wts-sop')} aria-label="คิดเงินเดือนที่">
          <option value="buddy">Buddy Account (เมนูเงินเดือน)</option>
          <option value="wts-sop">WTS-HR (ส่งใบสำคัญเงินเดือนเข้ามา)</option>
        </select>
      </label>
      <span className="muted small"> 1 บริษัทคิดเงินเดือนที่เดียว — เลือก WTS-HR แล้วเมนูคิดเงินเดือนของบริษัทนี้ใน Buddy จะปิด (ข้อมูลเดิมไม่หาย)</span>
      {ask && ask !== cur && <Confirm title="เปลี่ยนที่คิดเงินเดือน" okText="เปลี่ยน" danger={ask === 'wts-sop'} onOk={() => save(ask)} onClose={() => setAsk(null)}
        text={ask === 'wts-sop' ? <>คิดเงินเดือนที่ <b>WTS-HR</b>? เมนูคิดเงินเดือนของบริษัทนี้ใน Buddy จะปิดทันที — ใบสำคัญเงินเดือนให้ WTS-HR ส่งเข้ามาด้วยกุญแจ API</> : <>กลับมาคิดเงินเดือนใน <b>Buddy Account</b>? เมนูเงินเดือนจะเปิด — ตรวจว่า WTS-HR เลิกส่งใบสำคัญของบริษัทนี้แล้ว</>} />}
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
        <p className="hint">ใช้กับ WTS-POS (หน้าร้าน ครัวกลาง แฟรนไชส์) — สร้างชุดเริ่มต้นที่ยังไม่มี: ประเภทเอกสารเบิกใช้ OUR ตามสูตร · OUW ของเสีย · OUS อาหารพนักงาน · OUQ ชิมคุณภาพ · ครัวกลาง OUP เบิกวัตถุดิบผลิต · JUP รับสินค้าผลิตเสร็จ ·
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

type LivingRow = { group: string; key: string; code: string; name: string; status: 'exists' | 'create' | 'set' | 'blocked'; account?: { no: string; name: string } | null; note?: string | null };
type LivingPlan = { rows: LivingRow[]; create: number; exists: number; blocked: number; created?: string[] };
const LIVING_GROUP: Record<string, string> = { account: 'บัญชี', role: 'บทบาทบัญชี', book: 'สมุดรายวัน', doc_type: 'ประเภทเอกสาร', payment_method: 'วิธีรับชำระ', item: 'รหัสรายได้', setting: 'ค่าตั้ง', customer: 'ลูกค้า' };
const LIVING_STATUS: Record<LivingRow['status'], { label: string; done: string; cls: string }> = {
  exists: { label: 'มีแล้ว', done: 'มีแล้ว', cls: 'st-x' }, create: { label: 'จะสร้าง', done: 'สร้างแล้ว', cls: 'st-n' },
  set: { label: 'จะตั้งค่า', done: 'ตั้งค่าแล้ว', cls: 'st-n' }, blocked: { label: 'ต้องทำเอง', done: 'ต้องทำเอง', cls: 'st-c' },
};

/**
 * ปุ่ม "ตั้งค่าสำหรับ WTS-Living" (HANDOFF ข้อ 86): รายการตรวจ มีแล้ว / จะสร้าง + บัญชีที่แต่ละรายการใช้ → ยืนยัน → สร้างที่ยังไม่มี
 * เฉพาะผู้ดูแลระบบ · กดซ้ำได้ (ไม่สร้างซ้ำ ไม่ทับของเดิม) · WTS-Living กด "ดึงค่าจาก Buddy" แล้วได้รหัสครบโดยไม่ต้องคีย์
 */
export function WtsLivingSetup() {
  const { me } = useSession();
  const admin = !!me?.user?.is_admin;
  const q = useQuery({ queryKey: ['wts-living-setup'], queryFn: () => api.get<LivingPlan>('/api/v1/company/wts-living-setup'), enabled: admin });
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<LivingPlan | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    setAsk(false); setErr(null); setBusy(true);
    try {
      const r = await api.post<LivingPlan>('/api/v1/company/wts-living-setup', {});
      setDone(r);
      toast(r.created?.length ? `สร้างแล้ว ${r.created.length} รายการ — ไปที่ WTS-Living › ตั้งค่าสำหรับ Buddy แล้วกด "ดึงค่าจาก Buddy"` : 'มีครบแล้ว ไม่ต้องสร้างเพิ่ม');
      await qc.invalidateQueries({ queryKey: ['wts-living-setup'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const plan = done ?? q.data;
  return (
    <>
      <h2 className="section-title">ตั้งค่าสำหรับ WTS-Living</h2>
      <div className="card">
        <p className="hint">ใช้กับ WTS-Living (หอพัก อพาร์ตเมนต์ นิติบุคคล) — สร้างสิ่งที่ WTS-Living ต้องใช้ที่ยังไม่มี จากผังบัญชีของบริษัทนี้:
          บัญชีเงินประกันผู้เช่า รายได้รับล่วงหน้า เงินกองทุน บัญชีพักยอดยกมา และบัญชีรายได้ · ประเภทเอกสาร IVL REL AIL RDL ADL · สมุดรายวัน LV · วิธีรับชำระหักเงินประกัน · รหัสรายได้ 50-LIVR-… ·
          รายการที่มีอยู่แล้วไม่ถูกแก้ · กดซ้ำได้ · เสร็จแล้วไปที่ WTS-Living › ตั้งค่าสำหรับ Buddy กด <b>ดึงค่าจาก Buddy</b> (ไม่ต้องคีย์รหัสเอง)</p>
        {!admin && <p className="warn-text">เฉพาะผู้ดูแลระบบของบริษัทนี้กดตั้งค่าได้ — ให้ผู้ดูแลระบบเข้าหน้านี้</p>}
        <ErrorBox error={err ?? q.error} />
        {admin && plan && <>
          <p className="living-sum">
            {done ? <><b className="ok">✓ ตั้งค่าแล้ว</b> สร้าง/ตั้งค่า {done.created?.length ?? 0} รายการ · มีอยู่แล้ว {done.exists} รายการ</>
              : <>จะสร้าง/ตั้งค่า <b>{plan.create}</b> รายการ · มีอยู่แล้ว <b>{plan.exists}</b> รายการ</>}
            {plan.blocked > 0 && <> · <b className="bad">ต้องทำเอง {plan.blocked} รายการ</b> (ดูหมายเหตุ)</>}
          </p>
          <div className="table-wrap living-setup">
            <table className="grid">
              <thead><tr><th>กลุ่ม</th><th>รหัส</th><th>รายการ</th><th>สถานะ</th><th>บัญชีที่ใช้</th><th>หมายเหตุ</th></tr></thead>
              <tbody>{plan.rows.map((r) => (
                <tr key={`${r.group}:${r.key}`}>
                  <td data-label="กลุ่ม">{LIVING_GROUP[r.group] ?? r.group}</td>
                  <td data-label="รหัส" className="mono">{r.code || '—'}</td>
                  <td data-label="รายการ">{r.name}</td>
                  <td data-label="สถานะ"><span className={`pill ${LIVING_STATUS[r.status].cls}`}>{done ? LIVING_STATUS[r.status].done : LIVING_STATUS[r.status].label}</span></td>
                  <td data-label="บัญชีที่ใช้">{r.account ? <><span className="mono">{r.account.no}</span> {r.account.name}</> : r.account === null ? <span className="muted">ตามการเชื่อมต่อบัญชี</span> : '—'}</td>
                  <td data-label="หมายเหตุ" className="muted small">{r.note ?? ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="theme-acts">
            <button type="button" className="primary" disabled={busy || (!done && plan.create === 0)} onClick={() => setAsk(true)}>{plan.create === 0 && !done ? 'มีครบแล้ว' : 'ตั้งค่าสำหรับ WTS-Living'}</button>
            {done && <button type="button" onClick={() => { setDone(null); void q.refetch(); }}>ตรวจอีกครั้ง</button>}
          </div>
        </>}
      </div>
      {ask && plan && <Confirm title="ตั้งค่าสำหรับ WTS-Living" okText="สร้าง" onOk={run} onClose={() => setAsk(false)}
        text={<>สร้าง/ตั้งค่า <b>{plan.create}</b> รายการตามตารางในบริษัทนี้? รายการที่มีอยู่แล้ว {plan.exists} รายการไม่ถูกแก้{plan.blocked ? ` · ${plan.blocked} รายการต้องทำเอง (ข้ามไป)` : ''}</>} />}
    </>
  );
}
