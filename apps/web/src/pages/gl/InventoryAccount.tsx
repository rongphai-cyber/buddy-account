import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, cx, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, PageHead, Pill, toast, useHotkeys } from '../../ui';

/** บัญชีสินค้าคงเหลือ Periodic (คู่มือ S-GL-14/15) — ยอดปลายงวดที่ยืนยันใช้ในงบการเงิน (ข้อมูลชนิด INV) */
interface Row { period_no: number; date: string; entered: string | null; source: 'M' | 'S' | null; system: string | null; gl: string }
export function InventoryAccountPage() {
  const qc = useQueryClient();
  const can = useCan('GL.INV');
  const accs = useQuery({ queryKey: ['gl-inventory-accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; account_no: string; name_th: string }> }>('/api/v1/gl/inventory-accounts') });
  const years = useQuery({ queryKey: ['gl-periods-years'], queryFn: () => api.get<Array<{ id: string; code: string; start_date: string; end_date: string }>>('/api/v1/gl/periods') });
  const [acc, setAcc] = useState('');
  const [fy, setFy] = useState('');
  const account = acc || accs.data?.rows[0]?.id || '';
  const data = useQuery({ enabled: !!account, queryKey: ['gl-inventory', account, fy], staleTime: 0, queryFn: () => api.get<{ account: { account_no: string; name_th: string }; fiscal_year: { id: string; code: string }; rows: Row[] }>('/api/v1/gl/inventory', { account_id: account, ...(fy ? { fiscal_year_id: fy } : {}) }) });
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const [calc, setCalc] = useState(false);
  const [period, setPeriod] = useState('-1');
  const rows = data.data?.rows ?? [];
  const val = (r: Row) => (r.period_no in edit ? edit[r.period_no]! : r.entered ?? '');
  const dirty = Object.keys(edit).length > 0;
  const save = async () => {
    if (!data.data || !dirty) return;
    setErr(null);
    try {
      await api.put('/api/v1/gl/inventory', { account_id: account, fiscal_year_id: data.data.fiscal_year.id, rows: rows.map((r) => ({ period_no: r.period_no, amount: val(r) || null, source: r.period_no in edit ? 'M' : r.source ?? 'M' })) });
      toast('บันทึกบัญชีสินค้าคงเหลือแล้ว'); setEdit({}); qc.invalidateQueries({ queryKey: ['gl-inventory'] });
    } catch (e) { setErr(e); }
  };
  const compute = async () => {
    setErr(null);
    try { await api.post('/api/v1/gl/inventory/compute', { account_id: account, fiscal_year_id: data.data!.fiscal_year.id, period: Number(period) }); toast('คำนวณยอดคงเหลือจากระบบสินค้าแล้ว'); setCalc(false); setEdit({}); qc.invalidateQueries({ queryKey: ['gl-inventory'] }); }
    catch (e) { setCalc(false); setErr(e); }
  };
  useHotkeys({ F9: can('edit') ? save : undefined, 'Ctrl+S': can('edit') ? save : undefined, F5: can('edit') && data.data ? () => setCalc(true) : undefined }, []);
  const opening = rows.find((r) => r.period_no === 0);
  return (
    <div className="page" data-tone="ledger">
      <PageHead eyebrow="บัญชี" title="บัญชีสินค้าคงเหลือ" lead="สำหรับบันทึกบัญชีสินค้าแบบ Periodic (ไม่ลงบัญชีสินค้าในสมุดรายวัน): ป้อนยอดสินค้าคงเหลือปลายงวดจากการตรวจนับ หรือคำนวณจากระบบสินค้า (F5) — งบการเงินใช้ยอดนี้ (งวดที่ว่างใช้ยอดบัญชี) · ยอดยกมาต้องเท่ายอดยกมาในระบบบัญชี"
        actions={can('edit') && <><button disabled={!data.data} onClick={() => setCalc(true)}>คำนวณยอดคงเหลือจากระบบสินค้า <kbd>F5</kbd></button><button className="primary" disabled={!dirty} onClick={save}>บันทึก <kbd>F9</kbd></button></>} />
      <div className="toolbar">
        <label>เลขที่บัญชี <select value={account} onChange={(e) => { setAcc(e.target.value); setEdit({}); }} aria-label="เลขที่บัญชี">{accs.data?.rows.map((a) => <option key={a.id} value={a.id}>{a.account_no} {a.name_th}</option>)}</select></label>
        <label>ปีบัญชี <select value={fy || data.data?.fiscal_year.id || ''} onChange={(e) => { setFy(e.target.value); setEdit({}); }} aria-label="ปีบัญชี">{years.data?.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}</select></label>
      </div>
      <ErrorBox error={err ?? data.error ?? accs.error} />
      {accs.data && !accs.data.rows.length && <p className="empty">ยังไม่มีบัญชีสินค้าคงเหลือ — กำหนดบัญชีสินค้าที่ กลุ่มบัญชีสินค้า หรือ บัญชีเพื่อลงรายวัน (สินค้าคงเหลือ)</p>}
      {opening && <p className={cx('small', opening.entered && !d(opening.entered).eq(d(opening.gl)) ? 'bad' : 'muted')}>ยอดยกมาปีปัจจุบันในระบบบัญชี <Money v={opening.gl} />{opening.entered && !d(opening.entered).eq(d(opening.gl)) ? ' — ไม่เท่ากับยอดยกมาที่ป้อน ตรวจสอบ บันทึกยอดยกมา' : ''}</p>}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 70 }}>งวด</th><th style={{ width: 120 }}>สิ้นงวด</th><th className="r" style={{ width: 180 }}>คงเหลือปลายงวด (ใช้ในงบ)</th><th style={{ width: 120 }}>ที่มา</th><th className="r" style={{ width: 170 }}>ยอดจากระบบสินค้า</th><th className="r" style={{ width: 170 }}>ยอดตามบัญชี</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period_no} className={cx(r.period_no in edit && 'changed')}>
                <td>{r.period_no === 0 ? 'ยกมา' : r.period_no}</td><td><DateText v={r.date} /></td>
                <td><MoneyInput value={val(r)} disabled={!can('edit')} placeholder="ใช้ยอดบัญชี" onChange={(v) => setEdit((e) => ({ ...e, [r.period_no]: v }))} aria-label={`งวด ${r.period_no}`} /></td>
                <td>{r.period_no in edit ? <Pill tone="c">แก้ไข</Pill> : r.source === 'S' ? <Pill tone="n">ระบบสินค้า</Pill> : r.source === 'M' ? <Pill tone="m">ป้อนเอง</Pill> : ''}</td>
                <td className="r muted">{r.system !== null ? <Money v={r.system} /> : '—'}</td><td className="r muted"><Money v={r.gl} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['F5', 'คำนวณจากระบบสินค้า'], ['F9', 'บันทึก']]} />
      {calc && <Confirm title="คำนวณยอดคงเหลือ จากระบบสินค้า" text="ยอดที่คำนวณได้จะแทนยอดเดิมของงวดที่เลือก · ทุกงวด: งวดที่ยังไม่มีรายการได้ยอดเท่างวดล่าสุดที่เคลื่อนไหว (คำนวณใหม่เมื่อสิ้นเดือนถัดไป)" okText="ทำงาน" onClose={() => setCalc(false)} onOk={compute}>
        <Field label="งวดบัญชี"><select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="งวดบัญชี"><option value="-1">−1 ทุกงวด (รวมยอดยกมา)</option><option value="0">0 ยอดยกมา</option>{rows.filter((r) => r.period_no > 0).map((r) => <option key={r.period_no} value={r.period_no}>{r.period_no}</option>)}</select></Field>
      </Confirm>}
    </div>
  );
}
