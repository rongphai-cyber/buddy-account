import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, DateInput, ErrorBox, Field, KeyHints, Modal, navKey, PageHead, toast, toastError, useHotkeys } from '../../ui';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
const Dec = ({ value, onChange, ...rest }: { value: string | null | undefined; onChange: (v: string) => void; [k: string]: unknown }) =>
  <input inputMode="decimal" className="r" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} {...rest} />;
type Picked = { id: string; code: string; name: string } | null;
const KINDS = [['items', 'สินค้า'], ['kits', 'สินค้าชุด'], ['services', 'สินค้าบริการ']] as const;

/* ---------------------------------------------------------------- ตารางราคาขาย S-IC-06 */
interface Break { unit_id: string | null; factor: string; min_qty: string; is_percent: boolean; price_1: string; price_2: string; price_3: string; price_4: string; price_5: string; start_date: string | null; end_date: string | null }
interface PriceData { id: string; code: string; name_th: string; name_en: string | null; base_unit_code: string | null; base_unit_name: string | null; sales_unit_id: string | null; sales_factor: string; price_1: string | null; price_2: string | null; price_3: string | null; price_4: string | null; price_5: string | null; breaks: Break[] }

export function PricesPage() {
  const can = useCan('IC.PRICE');
  const qc = useQueryClient();
  const lk = useLookups('UNIT');
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('items');
  const [item, setItem] = useState<Picked>(null);
  const cur = useQuery({ enabled: !!item, queryKey: ['prices', item?.id], queryFn: () => api.get<PriceData>(`/api/v1/items/${item!.id}/prices`), staleTime: 0 });
  const [f, setF] = useState<{ id: string; sales_unit_id: string; sales_factor: string; p: string[]; breaks: Break[] } | null>(null);
  if (cur.data && f?.id !== cur.data.id) setF({ id: cur.data.id, sales_unit_id: cur.data.sales_unit_id ?? '', sales_factor: num(cur.data.sales_factor) || '1', p: [1, 2, 3, 4, 5].map((n) => num(cur.data[`price_${n}` as 'price_1'])), breaks: cur.data.breaks.map((b) => ({ ...b, factor: num(b.factor), min_qty: num(b.min_qty), ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`price_${n}`, num(b[`price_${n}` as 'price_1'])])) })) });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f || busy || !can('edit')) return;
    setErr(null); setBusy(true);
    try {
      await api.put(`/api/v1/items/${f.id}/prices`, { sales_unit_id: f.sales_unit_id || null, sales_factor: f.sales_factor || '1', ...Object.fromEntries(f.p.map((v, i) => [`price_${i + 1}`, v || null])),
        breaks: f.breaks.map((b) => ({ ...b, factor: b.factor || '1', ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`price_${n}`, b[`price_${n}` as 'price_1'] || null])) })) });
      toast(`บันทึกตารางราคา ${item?.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['prices', f.id] }); qc.invalidateQueries({ queryKey: ['items'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const setB = (i: number, p: Partial<Break>) => setF((x) => x && ({ ...x, breaks: x.breaks.map((b, k) => (k === i ? { ...b, ...p } : b)) }));
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า › ตารางราคาขาย" title="ตารางราคาขาย"
        lead="ราคาหลัก 1–5 ของหน่วยขาย และราคาเสริม: ส่วนลดตามปริมาณ โปรโมชั่นช่วงเวลา หน่วยขายอื่น (เช่น ขายเป็นโหล) — ติ๊ก % เมื่อป้อนเป็นเปอร์เซ็นต์ส่วนลดจากราคาปกติ"
        actions={f && can('edit') && <button className="primary" disabled={busy} onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <div className="toolbar">
        <select value={kind} onChange={(e) => { setKind(e.target.value as 'items'); setItem(null); setF(null); }} aria-label="ชนิดสินค้า">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div style={{ minWidth: 380 }}><SearchPick endpoint={`/api/v1/${kind}`} value={item} label={(r: { name_th: string }) => r.name_th} autoFocus aria-label="รหัสสินค้า"
          onPick={(r: { id: string; code: string; name_th: string } | null) => { setItem(r ? { id: r.id, code: r.code, name: r.name_th } : null); setF(null); setErr(null); }} /></div>
        {cur.data && <span className="muted">หน่วยย่อย: <b>{cur.data.base_unit_code} {cur.data.base_unit_name}</b></span>}
      </div>
      <ErrorBox error={err ?? cur.error} />
      {!item && <p className="muted">เลือกสินค้าที่ต้องการกำหนดราคา (พิมพ์รหัสหรือชื่อ)</p>}
      {f && <div onKeyDown={navKey}>
        <fieldset className="box"><legend>ตารางราคาหลัก</legend>
          <div className="form-grid price-main">
            <Field label="หน่วยขายเป็น"><LkSelect byId rows={lk.data?.UNIT} value={f.sales_unit_id} onChange={(v) => setF({ ...f, sales_unit_id: v })} /></Field>
            <Field label="ตัวคูณให้เป็นหน่วยย่อย"><Dec value={f.sales_factor} onChange={(v) => setF({ ...f, sales_factor: v })} /></Field>
            {f.p.map((v, i) => <Field key={i} label={`ราคาที่ ${i + 1}`}><Dec value={v} onChange={(x) => setF({ ...f, p: f.p.map((y, k) => (k === i ? x : y)) })} /></Field>)}
          </div>
        </fieldset>
        <fieldset className="box"><legend>ตารางราคาเสริม</legend>
          <div className="table-wrap lines">
            <table className="grid">
              <thead><tr><th className="r" style={{ width: 90 }}>ตั้งแต่ (จำนวน)</th><th style={{ width: 110 }}>หน่วยขาย</th><th className="r" style={{ width: 70 }}>ตัวคูณ</th><th style={{ width: 40 }}>%</th>{[1, 2, 3, 4, 5].map((n) => <th key={n} className="r">ราคาที่ {n}</th>)}<th style={{ width: 130 }}>เริ่ม</th><th style={{ width: 130 }}>สิ้นสุด</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {f.breaks.map((b, i) => (
                  <tr key={i}>
                    <td><Dec value={b.min_qty} onChange={(v) => setB(i, { min_qty: v })} aria-label="ปริมาณขั้นต่ำ" /></td>
                    <td><LkSelect byId rows={lk.data?.UNIT} value={b.unit_id} onChange={(v) => setB(i, { unit_id: v || null })} aria-label="หน่วยขาย" /></td>
                    <td><Dec value={b.factor} onChange={(v) => setB(i, { factor: v })} aria-label="ตัวคูณ" /></td>
                    <td className="c"><input type="checkbox" checked={b.is_percent} onChange={(e) => setB(i, { is_percent: e.target.checked })} aria-label="ราคาเป็น % ส่วนลด" /></td>
                    {[1, 2, 3, 4, 5].map((n) => <td key={n}><Dec value={b[`price_${n}` as 'price_1']} onChange={(v) => setB(i, { [`price_${n}`]: v })} aria-label={`ราคาที่ ${n}`} /></td>)}
                    <td><DateInput value={b.start_date} onChange={(v) => setB(i, { start_date: v || null })} /></td>
                    <td><DateInput value={b.end_date} onChange={(v) => setB(i, { end_date: v || null })} /></td>
                    <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setF({ ...f, breaks: f.breaks.filter((_, k) => k !== i) })}>✕</button></td>
                  </tr>
                ))}
                {!f.breaks.length && <tr><td colSpan={12} className="empty">ยังไม่มีราคาเสริม</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={12}><button type="button" onClick={() => setF({ ...f, breaks: [...f.breaks, { unit_id: f.sales_unit_id || null, factor: f.sales_factor || '1', min_qty: '', is_percent: false, price_1: '', price_2: '', price_3: '', price_4: '', price_5: '', start_date: null, end_date: null }] })}>+ เพิ่มราคาเสริม</button> <span className="hint">เช่น ซื้อตั้งแต่ 10 ตัว ราคา 7,000 ช่วง 08/06–16/06 · ติ๊ก % แล้วใส่ 2 = ลด 2% ทุกระดับราคา</span></td></tr></tfoot>
            </table>
          </div>
        </fieldset>
      </div>}
      <KeyHints keys={[['F4 / ↓', 'ค้นหาสินค้า'], ['F9', 'บันทึก']]} />
    </div>
  );
}

/* ---------------------------------------------------------------- จุดสั่งซื้อ S-IC-07 */
interface RoRow { warehouse_id: string; start_mmdd: string; min_qty: string; max_qty: string; order_qty: string; projected_sales: string }
interface RoData { id: string; code: string; name_th: string; base_unit_code: string | null; rows: Array<RoRow & { warehouse_code: string }>; stock: Array<{ warehouse_id: string; warehouse_code: string; warehouse_name: string; qty_on_hand: string; shelf: string | null }> }
const mmdd = (v: string) => (v.length === 4 ? `${v.slice(0, 2)}/${v.slice(2)}` : v);

export function ReorderPage() {
  const can = useCan('IC.REORDER');
  const qc = useQueryClient();
  const lk = useLookups('WH');
  const [item, setItem] = useState<Picked>(null);
  const cur = useQuery({ enabled: !!item, queryKey: ['reorder', item?.id], queryFn: () => api.get<RoData>(`/api/v1/items/${item!.id}/reorder`), staleTime: 0 });
  const [rows, setRows] = useState<RoRow[] | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (cur.data && loaded !== cur.data.id) { setLoaded(cur.data.id); setRows(cur.data.rows.map((r) => ({ warehouse_id: r.warehouse_id, start_mmdd: mmdd(r.start_mmdd), min_qty: num(r.min_qty), max_qty: num(r.max_qty), order_qty: num(r.order_qty), projected_sales: num(r.projected_sales) }))); }
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    if (!rows || !item || !can('edit')) return;
    setErr(null);
    try {
      await api.put(`/api/v1/items/${item.id}/reorder`, { rows: rows.map((r) => ({ ...r, start_mmdd: r.start_mmdd.replace(/\D/g, ''), min_qty: r.min_qty || null, max_qty: r.max_qty || null, order_qty: r.order_qty || null, projected_sales: r.projected_sales || null })) });
      toast(`บันทึกจุดสั่งซื้อ ${item.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['reorder', item.id] }); setLoaded(null);
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const set = (i: number, p: Partial<RoRow>) => setRows((rs) => rs!.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า › กำหนดจุดสั่งซื้อ" title="กำหนดจุดสั่งซื้อ"
        lead="กำหนดแยกคลัง และหลายช่วงในปีได้ (เช่น ปกติ 20 ตัว ตั้งแต่ ธ.ค. 50 ตัว) — เตือนเมื่อยอดคงเหลือต่ำกว่าจุดสั่งซื้อ (หรือจุดสั่งซื้อ + ยอดขายโครงการ) และเมื่อเกินจำนวนสูงสุด"
        actions={rows && can('edit') && <button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <div className="toolbar">
        <div style={{ minWidth: 380 }}><SearchPick endpoint="/api/v1/items" value={item} label={(r: { name_th: string }) => r.name_th} autoFocus aria-label="รหัสสินค้า"
          onPick={(r: { id: string; code: string; name_th: string } | null) => { setItem(r ? { id: r.id, code: r.code, name: r.name_th } : null); setRows(null); setLoaded(null); setErr(null); }} /></div>
        {cur.data && <span className="muted">หน่วยนับ: <b>{cur.data.base_unit_code}</b></span>}
      </div>
      <ErrorBox error={err ?? cur.error} />
      {!item && <p className="muted">เลือกสินค้า (พิมพ์รหัสหรือชื่อ)</p>}
      {rows && cur.data && <div onKeyDown={navKey}>
        {!!cur.data.stock.length && <p className="small">ยอดคงเหลือ: {cur.data.stock.map((s) => <span key={s.warehouse_id} className="chip"><b className="mono">{s.warehouse_code}</b> {d(s.qty_on_hand).toNumber().toLocaleString('th-TH')}{s.shelf ? ` · ชั้น ${s.shelf}` : ''}</span>)}</p>}
        <div className="table-wrap lines">
          <table className="grid">
            <thead><tr><th style={{ width: 200 }}>คลัง</th><th style={{ width: 100 }}>เดือน/วัน ที่เริ่ม</th><th className="r">จุดสั่งซื้อ</th><th className="r">จำนวนสูงสุด</th><th className="r">ซื้อครั้งละ</th><th className="r">ยอดขายโครงการ</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><LkSelect byId rows={lk.data?.WH} value={r.warehouse_id} onChange={(v) => set(i, { warehouse_id: v })} blank="— เลือกคลัง —" aria-label="คลัง" /></td>
                  <td><input className="mono" value={r.start_mmdd} maxLength={5} placeholder="MM/DD" onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, '').slice(0, 4); set(i, { start_mmdd: v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v }); }} aria-label="เดือน/วันที่เริ่ม" /></td>
                  <td><Dec value={r.min_qty} onChange={(v) => set(i, { min_qty: v })} aria-label="จุดสั่งซื้อ" /></td>
                  <td><Dec value={r.max_qty} onChange={(v) => set(i, { max_qty: v })} aria-label="จำนวนสูงสุด" /></td>
                  <td><Dec value={r.order_qty} onChange={(v) => set(i, { order_qty: v })} aria-label="ซื้อครั้งละ" /></td>
                  <td><Dec value={r.projected_sales} onChange={(v) => set(i, { projected_sales: v })} aria-label="ยอดขายโครงการ" /></td>
                  <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="empty">ยังไม่ได้กำหนดจุดสั่งซื้อ</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={7}><button type="button" onClick={() => setRows([...rows, { warehouse_id: rows.at(-1)?.warehouse_id ?? cur.data!.stock[0]?.warehouse_id ?? '', start_mmdd: '01/01', min_qty: '', max_qty: '', order_qty: '', projected_sales: '' }])}>+ เพิ่มช่วงเวลา</button> <span className="hint">วันที่เริ่มใช้ค่านี้ในแต่ละปี — ก่อนวันนี้ไม่เตือน</span></td></tr></tfoot>
          </table>
        </div>
      </div>}
      <KeyHints keys={[['F4 / ↓', 'ค้นหาสินค้า'], ['F9', 'บันทึก']]} />
    </div>
  );
}

/* ---------------------------------------------------------------- กลุ่มบัญชีสินค้า S-SET-04 */
interface Group { id: string; code: string; name_th: string; name_en: string | null; cost_method: string | null; item_count: number; inventory_account_id: string | null; cogs_account_id: string | null; sales_account_id: string | null; sales_return_account_id: string | null; purchase_account_id: string | null; purchase_return_account_id: string | null }
const ACC_FIELDS: Array<[keyof Group, string, string?]> = [
  ['inventory_account_id', 'บัญชีสินค้า', 'เช่น 1140-02 สินค้าสำเร็จรูปคงเหลือ'], ['cogs_account_id', 'บ/ช ต้นทุนขาย', 'เช่น 5110-00'],
  ['sales_account_id', 'บ/ช ขายสินค้า', 'ว่าง = ใช้บัญชีที่เริ่มระบบ 5.2'], ['sales_return_account_id', 'รับคืนสินค้า', 'ว่าง = ใช้บัญชีที่เริ่มระบบ 5.2'],
  ['purchase_account_id', 'บ/ช ซื้อสินค้า (Periodic)', 'ว่าง = ใช้บัญชีที่เริ่มระบบ 5.2'], ['purchase_return_account_id', 'ส่งคืนสินค้า (Periodic)', 'ว่าง = ใช้บัญชีที่เริ่มระบบ 5.2'],
];
export function ItemAccountGroupsPage() {
  const can = useCan('SET.IAG');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['iag'], queryFn: () => api.get<Group[]>('/api/v1/item-account-groups') });
  const [edit, setEdit] = useState<Group | 'new' | null>(null);
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › กลุ่มบัญชีสินค้า" title="กำหนดกลุ่มบัญชีสินค้า"
        lead="กำหนดวิธีคิดต้นทุน (FIFO / ถัวเฉลี่ย) และบัญชีที่ใช้ลงรายวันอัตโนมัติของสินค้าแต่ละกลุ่ม — ผูกกลุ่มกับสินค้าที่หน้ารายละเอียดสินค้า · บัญชีที่ว่างใช้บัญชีจาก เริ่มระบบ 5.2"
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มกลุ่มบัญชี <kbd>Ins</kbd></button>} />
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 80 }}>รหัส</th><th>คำอธิบาย</th><th>คำอธิบาย (อังกฤษ)</th><th style={{ width: 130 }}>วิธีคิดต้นทุน</th><th className="r" style={{ width: 100 }}>จำนวนสินค้า</th></tr></thead>
          <tbody>
            {list.data?.map((g) => <tr key={g.id} className="row-open" tabIndex={0} onClick={() => setEdit(g)} onKeyDown={(e) => e.key === 'Enter' && setEdit(g)}>
              <td className="mono">{g.code}</td><td>{g.name_th}</td><td className="muted">{g.name_en}</td><td>{g.cost_method === 'A' ? 'ถัวเฉลี่ย' : g.cost_method === 'F' ? 'เข้าก่อนออกก่อน' : '—'}</td><td className="r">{Number(g.item_count).toLocaleString()}</td></tr>)}
            {list.data && !list.data.length && <tr><td colSpan={5} className="empty">ยังไม่มีกลุ่มบัญชีสินค้า — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <GroupForm g={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['iag'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); }} />}
    </div>
  );
}
function GroupForm({ g, onClose, onSaved }: { g: Group | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan('SET.IAG');
  const [f, setF] = useState<Record<string, string | null>>(g ? { ...g } as unknown as Record<string, string | null> : { code: '', name_th: '', name_en: '', cost_method: 'F' });
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState(false);
  const allowed = can(g ? 'edit' : 'add');
  const save = async () => {
    if (!allowed) return;
    setErr(null);
    const body = { code: f.code, name_th: f.name_th, name_en: f.name_en || null, cost_method: f.cost_method, ...Object.fromEntries(ACC_FIELDS.map(([k]) => [k, f[k] || null])) };
    try { if (g) await api.put(`/api/v1/item-account-groups/${g.id}`, body); else await api.post('/api/v1/item-account-groups', body); toast(`บันทึกกลุ่มบัญชี ${String(f.code).toUpperCase()} แล้ว`); onSaved(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  return (
    <Modal title={g ? `แก้ไขกลุ่มบัญชี ${g.code}` : 'เพิ่มกลุ่มบัญชีสินค้า'} onClose={onClose}
      footer={<>{g && can('delete') && <button className="danger" onClick={() => setAsk(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!allowed} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="รหัสกลุ่มบัญชี" req hint="ตัวอักษรหรือตัวเลขไม่เกิน 4 ตัว เช่น ST01"><input autoFocus className="mono" value={f.code ?? ''} maxLength={4} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="วิธีคิดต้นทุนสินค้า" req><select value={f.cost_method ?? 'F'} onChange={(e) => setF({ ...f, cost_method: e.target.value })}><option value="F">เข้าก่อนออกก่อน (FIFO)</option><option value="A">ถัวเฉลี่ย (Average)</option></select></Field>
        <Field label="คำอธิบายไทย" req><input value={f.name_th ?? ''} maxLength={120} onChange={(e) => setF({ ...f, name_th: e.target.value })} placeholder="เช่น สินค้าสำเร็จรูป FIFO" /></Field>
        <Field label="คำอธิบายอังกฤษ"><input value={f.name_en ?? ''} maxLength={120} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        {ACC_FIELDS.map(([k, label, hint], i) => <Field key={k} label={label} req={i < 2} hint={hint}><AccountCell value={f[k] ?? null} onChange={(a) => setF((x) => ({ ...x, [k]: a?.id ?? null }))} /></Field>)}
      </div>
      {ask && g && <Confirm danger title="ลบกลุ่มบัญชี" text={`ลบกลุ่มบัญชี ${g.code}? ลบได้เฉพาะกลุ่มที่ไม่มีสินค้าใช้อยู่`} okText="ลบ" onClose={() => setAsk(false)}
        onOk={() => api.del(`/api/v1/item-account-groups/${g.id}`).then(() => { toast('ลบกลุ่มบัญชีแล้ว'); onSaved(); }).catch((e) => { setAsk(false); toastError(e); })} />}
    </Modal>
  );
}
