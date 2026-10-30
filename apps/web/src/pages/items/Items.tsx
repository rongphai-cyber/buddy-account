import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, ITEM_KINDS, ITEM_TYPE_TH, UDF_LABELS, type ItemKind } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { MasterNotesDialog } from '../../components/Notes';
import { ItemImagesTab, ItemThumb } from '../../components/ItemImages';
import { NumInput, Confirm, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';

type F = Record<string, string | null>;
interface Row { id: string; image_id: string | null; code: string; item_type: string; name_th: string; name_en: string | null; barcode: string | null; category_code: string | null; std_cost: string | null; price_1: string | null; status: string; unit_code: string | null; group_code: string | null; qty: string; value: string }
interface BomRow { component_item_id: string; component_code: string; component_name: string; unit_code: string | null; qty: string; std_cost: string | null; sell_price: string | null; warehouse_id: string | null; component_std_cost?: string | null; component_price_1?: string | null }
interface Detail extends Record<string, unknown> {
  id: string; code: string; item_type: string; account_group: { id: string; code: string } | null; accounts: Record<string, string | null>;
  warehouses: Array<{ warehouse_id: string; warehouse_code: string; warehouse_name: string; qty_on_hand: string; value_on_hand: string; avg_cost: string | null; qty_on_order: string; qty_reserved: string; last_purchase_date: string | null; last_sale_date: string | null; shelf: string | null }>;
  bom: BomRow[]; used_in_kits: Array<{ id: string; code: string; name_th: string }>; totals: { qty: string; value: string; unit_cost: string };
  last_purchase_date: string | null; last_sale_date: string | null;
  default_supplier: { id: string; code: string; name: string } | null; substitute_item: { id: string; code: string; name: string } | null;
}
const KEYS = ['code', 'barcode', 'name_th', 'name_en', 'item_type', 'status', 'category_code', 'item_level', 'remark', 'packing', 'account_group_id', 'base_unit_id', 'count_unit_id', 'count_factor', 'purchase_unit_id', 'purchase_factor', 'sales_unit_id', 'sales_factor',
  'std_cost', 'price_1', 'price_2', 'price_3', 'price_4', 'price_5', 'vat_code', 'allow_negative', 'udf_1', 'udf_2', 'udf_3', 'udf_4', 'udf_date_1', 'udf_date_2', 'udf_num_1'];
/** ตัวเลขจากฐานข้อมูล (numeric 4 ตำแหน่ง) แสดงแบบไม่มีศูนย์ท้าย */
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
const toForm = (r: Record<string, unknown>): F => Object.fromEntries(KEYS.map((k) => [k, r[k] === null || r[k] === undefined ? '' : /price|cost|factor|udf_num/.test(k) ? num(r[k]) : String(r[k])]));
const qtyFmt = (v: string | null | undefined) => (v === null || v === undefined ? '' : d(v).toNumber().toLocaleString('th-TH', { maximumFractionDigits: 4 }));

const LEADS: Record<ItemKind, string> = {
  stock: 'สินค้าที่มีสต๊อก: หน่วยนับ ราคาขาย 1–5 กลุ่มบัญชี (กำหนดบัญชีและวิธีคิดต้นทุน) ยอดคงเหลือแยกคลัง',
  kit: 'สินค้าชุดประกอบจากสินค้าในแฟ้ม — ชุดธรรมดา: ขายทั้งชุด เฉลี่ยราคาให้ส่วนประกอบตามสัดส่วน · ชุดพิเศษ: เลือกขายบางรายการได้ ไม่เฉลี่ย',
  service: 'สินค้าบริการ ไม่เกี่ยวกับสต๊อก — ขายแล้วเครดิตบัญชีรายได้ ถ้ามีต้นทุนบริการต่อหน่วยจะลงบัญชีต้นทุน/ค่าแรงให้ด้วย',
  income: 'รหัสรายได้อื่น ใช้ที่ ขาย › บันทึกรายได้อื่น ๆ — เครดิตบัญชีรายได้ที่กำหนด',
  expense: 'รหัสค่าใช้จ่ายอื่น ใช้ที่ ซื้อ › บันทึกค่าใช้จ่ายอื่น ๆ — เดบิตบัญชีค่าใช้จ่ายที่กำหนด ไม่กระทบสต๊อก',
};
const TONE: Record<ItemKind, string> = { stock: 'inventory', kit: 'inventory', service: 'inventory', income: 'sales', expense: 'purchase' };
const EYEBROW: Record<ItemKind, string> = { stock: 'สินค้า', kit: 'สินค้า', service: 'สินค้า', income: 'ขาย', expense: 'ซื้อ' };

export const StockItemsPage = () => <ItemsPage kind="stock" />;
export const KitsPage = () => <ItemsPage kind="kit" />;
export const ServicesPage = () => <ItemsPage kind="service" />;
export const OtherIncomesPage = () => <ItemsPage kind="income" />;
export const OtherExpensesPage = () => <ItemsPage kind="expense" />;

function ItemsPage({ kind }: { kind: ItemKind }) {
  const K = ITEM_KINDS[kind];
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const lk = useLookups('22');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'A' | 'I' | 'all'>('A');
  const [cat, setCat] = useState('');
  const [limit, setLimit] = useState(200);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: [K.path, q, status, cat, limit], queryFn: () => api.get<{ total: number; rows: Row[] }>(`/api/v1/${K.path}`, { q, status, category: cat, limit }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  const stockish = kind === 'stock' || kind === 'kit';
  // คอลัมน์รูปแสดงเมื่อมีสินค้าที่มีรูปในหน้านี้ (ไม่เปลืองที่สำหรับบริษัทที่ไม่ใช้รูป)
  const hasImg = !!list.data?.rows.some((r) => r.image_id);
  const title = kind === 'income' ? 'รายละเอียดรายได้อื่น ๆ' : kind === 'expense' ? 'รายละเอียดค่าใช้จ่ายอื่น ๆ' : `รายละเอียด${K.label}`;
  return (
    <div className="page" data-tone={TONE[kind]}>
      <PageHead eyebrow={`${EYEBROW[kind]} › ${title}`} title={title} lead={LEADS[kind]}
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่ม{K.label} <kbd>Ins</kbd></button>} />
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหารหัส ชื่อ หรือบาร์โค้ด" value={q} onChange={(e) => { setQ(e.target.value); setLimit(200); }} style={{ minWidth: 300 }} aria-label={`ค้นหา${K.label}`} />
        <LkSelect rows={lk.data?.['22']} value={cat} onChange={(v) => { setCat(v); setLimit(200); }} blank="ทุกหมวด" aria-label="หมวดสินค้า" />
        <select value={status} onChange={(e) => setStatus(e.target.value as 'A')} aria-label="สถานะ"><option value="A">เฉพาะที่ใช้งาน</option><option value="I">เฉพาะที่เลิกใช้</option><option value="all">ทั้งหมด</option></select>
        <span className="muted small">{list.data ? `${list.data.rows.length.toLocaleString()} จาก ${list.data.total.toLocaleString()} รายการ` : ''}</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr>
            {hasImg && <th style={{ width: 44 }} aria-label="รูป" />}<th style={{ width: 170 }}>รหัส</th><th>ชื่อ</th>{kind === 'kit' && <th style={{ width: 90 }}>ประเภท</th>}<th style={{ width: 80 }}>หมวด</th><th style={{ width: 70 }}>หน่วย</th>
            {kind === 'stock' && <th style={{ width: 70 }}>กลุ่มบัญชี</th>}
            {kind !== 'expense' && <th className="r" style={{ width: 110 }}>{kind === 'income' ? 'จำนวนเงิน' : 'ราคาขาย 1'}</th>}
            {kind === 'expense' && <th className="r" style={{ width: 110 }}>จำนวนเงิน</th>}
            {stockish && <th className="r" style={{ width: 110 }}>คงเหลือ</th>}{kind === 'stock' && <th className="r" style={{ width: 130 }}>มูลค่า</th>}
            <th style={{ width: 80 }}>สถานะ</th>
          </tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setEdit(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r.id)}>
                {hasImg && <td className="img-cell"><ItemThumb id={r.image_id} /></td>}<td className="mono">{r.code}</td><td>{r.name_th}{r.name_en && <span className="muted small"> · {r.name_en}</span>}</td>
                {kind === 'kit' && <td>{ITEM_TYPE_TH[r.item_type]}</td>}
                <td className="mono">{r.category_code}</td><td>{r.unit_code}</td>
                {kind === 'stock' && <td className="mono">{r.group_code}</td>}
                <td className="r"><Money v={r.price_1} blankZero /></td>
                {stockish && <td className="r num">{d(r.qty).isZero() ? '' : qtyFmt(r.qty)}</td>}{kind === 'stock' && <td className="r"><Money v={r.value} blankZero /></td>}
                <td>{r.status === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">เลิกใช้</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={10} className="empty">{q ? `ไม่พบ "${q}"` : `ยังไม่มี${K.label} — กด Ins เพื่อเพิ่ม`}</td></tr>}
          </tbody>
        </table>
      </div>
      {list.data && list.data.total > list.data.rows.length && <p><button onClick={() => setLimit((l) => l + 500)}>แสดงเพิ่มอีก 500 รายการ</button></p>}
      <KeyHints keys={[['Ins', `เพิ่ม${K.label}`], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <ItemForm kind={kind} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: [K.path] }); }} />}
    </div>
  );
}

/** ช่องตัวเลขทศนิยม (ราคา จำนวน ตัวคูณ) — เก็บเป็นข้อความ ไม่ใช้ number */
const Dec = ({ value, onChange, ...rest }: { value: string | null | undefined; onChange: (v: string) => void; [k: string]: unknown }) =>
  <NumInput value={value} onChange={onChange} {...rest} />;

export function ItemForm({ kind, id, onClose, onSaved, initial }: { kind: ItemKind; id: string | null; onClose: () => void; onSaved: (saved?: { id: string; code: string }) => void; initial?: F }) {
  const K = ITEM_KINDS[kind];
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const lk = useLookups('22,23,UNIT,IAG,WH');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ values: Record<string, unknown> }>('/api/v1/settings'), staleTime: 60_000 });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], queryFn: () => api.get<Detail>(`/api/v1/${K.path}/${id}`), staleTime: 0 });
  const [f, setF] = useState<F | null>(id ? null : { ...toForm({}), status: 'A', item_type: kind === 'kit' ? '1' : '', purchase_factor: '1', sales_factor: '1', ...initial });
  const [acc, setAcc] = useState<Record<string, string | null>>({});
  const [bom, setBom] = useState<BomRow[]>([]);
  const [sup, setSup] = useState<Detail['default_supplier']>(null);
  const [subst, setSubst] = useState<Detail['substitute_item']>(null);
  const [tab, setTab] = useState('main');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'delete' | 'copy' | null>(null);
  const [copyCode, setCopyCode] = useState('');
  if (id && cur.data && !f) {
    setF(toForm(cur.data)); setAcc(cur.data.accounts ?? {}); setBom(cur.data.bom.map((b) => ({ ...b, qty: num(b.qty), std_cost: num(b.std_cost), sell_price: num(b.sell_price) })));
    setSup(cur.data.default_supplier); setSubst(cur.data.substitute_item);
  }
  const set = (p: F) => setF((x) => ({ ...x!, ...p }));
  const t = (k: string, max: number, extra: Record<string, unknown> = {}) => ({ value: f?.[k] ?? '', maxLength: max, onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }), ...extra });
  const allowed = can(id ? 'edit' : 'add');
  const save = async () => {
    if (!f || busy || !allowed) return;
    setErr(null); setBusy(true);
    // ช่องว่าง = ไม่ระบุ (id/วันที่ว่างส่งเป็น null)
    const body = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])), item_type: kind === 'kit' ? f.item_type : undefined, default_supplier_id: sup?.id ?? null, substitute_item_id: subst?.id ?? null, accounts: acc,
      bom: kind === 'kit' ? bom.filter((b) => b.component_item_id).map((b) => ({ component_item_id: b.component_item_id, qty: b.qty || '0', std_cost: b.std_cost, sell_price: b.sell_price, warehouse_id: b.warehouse_id })) : undefined };
    try {
      const r = id ? await api.put<{ id: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก${K.label} ${f.code?.toUpperCase()} แล้ว`);
      qc.invalidateQueries({ queryKey: [K.path] });
      qc.invalidateQueries({ queryKey: ['pick'] });
      onSaved({ id: id ?? r.id, code: String(f.code ?? '').trim() });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = () => api.del(`/api/v1/${K.path}/${id}`).then(() => { toast(`ลบ${K.label}แล้ว`); onSaved(); }).catch((e) => { setAsk(null); toastError(e); });
  const copy = () => api.post<{ id: string }>(`/api/v1/kits/${id}/copy`, { code: copyCode }).then(() => { toast(`คัดลอกเป็น ${copyCode.toUpperCase()} แล้ว`); setAsk(null); onSaved(); }).catch((e) => toastError(e));
  useHotkeys({ F9: allowed ? save : undefined, 'Ctrl+S': allowed ? save : undefined, 'Alt+R': id ? () => setShowNotes(true) : undefined }, []);

  const udf = (settings.data?.values['ic.udf'] ?? {}) as Record<string, { use?: boolean; th?: string }>;
  const udfOn = Object.entries(UDF_LABELS).filter(([k]) => udf[k]?.use);
  const nonStock = kind === 'service' || kind === 'income' || kind === 'expense';
  const tabs = [{ key: 'main', label: 'รายละเอียด' },
    ...(kind === 'kit' ? [{ key: 'bom', label: 'รายการสินค้าประกอบ', badge: bom.length || undefined }] : []),
    ...(kind === 'service' || kind === 'income' ? [{ key: 'acc', label: 'บัญชี' }] : []),
    ...(kind === 'stock' && id ? [{ key: 'wh', label: 'คลังสินค้า', badge: cur.data?.warehouses.length || undefined }] : []),
    ...((kind === 'stock' || kind === 'expense') && udfOn.length ? [{ key: 'udf', label: 'ฟิลด์เพิ่มเติม' }] : []),
    ...(id && cur.data?.used_in_kits.length ? [{ key: 'kits', label: 'อยู่ในสินค้าชุด', badge: cur.data.used_in_kits.length }] : []),
    { key: 'img', label: 'รูปภาพ' }];
  const priceLabel = kind === 'income' || kind === 'expense';
  const [showNotes, setShowNotes] = useState(false);

  return (
    <Modal title={id ? `แก้ไข${K.label} ${f?.code ?? ''}` : `เพิ่ม${K.label}`} size="wide" onClose={onClose}
      footer={<>
        {id && <button onClick={() => setShowNotes(true)} title="หมายเหตุเพิ่มเติม (Alt+R)">📝 หมายเหตุ</button>}
        {id && kind === 'kit' && can('add') && <button onClick={() => { setCopyCode(''); setAsk('copy'); }}>คัดลอกสินค้าชุด</button>}
        {id && can('delete') && <button className="danger" onClick={() => setAsk('delete')}>ลบ</button>}
        <button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button>
        <button className="primary" disabled={!f || busy || !allowed} title={allowed ? undefined : 'ไม่มีสิทธิ์'} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? cur.error} />
      {f && <div onKeyDown={navKey}>
        <div className="form-grid party-head">
          <Field label={`รหัส${kind === 'income' ? 'รายได้' : kind === 'expense' ? 'ค่าใช้จ่าย' : 'สินค้า'}`} req hint={`รูปแบบ ${String(settings.data?.values['ic.item_code_mask'] ?? '')}`}><input autoFocus className="mono" {...t('code', 30)} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="บาร์โค้ด"><input className="mono" {...t('barcode', 30)} /></Field>
          <Field label="ชื่อไทย" req><input {...t('name_th', 120)} /></Field>
          <Field label="สถานะ"><select value={f.status ?? 'A'} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
          <Field label="ชื่ออังกฤษ" wide><input {...t('name_en', 120)} /></Field>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={tabs} />
        {tab === 'main' && <div className="form-grid party-grid">
          {kind === 'kit' && <Field label="ประเภทชุด" hint="ชุดพิเศษ = เลือกขายบางรายการได้ตอนเปิดบิล"><select value={f.item_type ?? '1'} onChange={(e) => set({ item_type: e.target.value })}><option value="1">1 ชุดธรรมดา</option><option value="2">2 ชุดพิเศษ</option></select></Field>}
          <Field label="หมวด"><LkSelect rows={lk.data?.['22']} value={f.category_code} onChange={(v) => set({ category_code: v })} /></Field>
          {kind === 'stock' && <Field label="กลุ่มบัญชีสินค้า" hint="กำหนดบัญชีและวิธีคิดต้นทุน (เริ่มระบบ › กลุ่มบัญชีสินค้า)"><LkSelect byId rows={lk.data?.IAG} value={f.account_group_id} onChange={(v) => set({ account_group_id: v })} missing="กลุ่มเฉพาะของสินค้านี้ (จาก Express)" /></Field>}
          {kind === 'kit' && <Field label="ระดับสินค้า" hint="ชุดซ้อนชุดต้องใช้ระดับต่างกัน"><LkSelect rows={lk.data?.['23']} value={f.item_level} onChange={(v) => set({ item_level: v })} /></Field>}
          <Field label={kind === 'stock' ? 'หน่วยนับย่อย' : 'หน่วยนับ'} req={kind === 'stock' || kind === 'kit'} hint={kind === 'stock' ? 'หน่วยเล็กที่สุด สต๊อกเก็บเป็นหน่วยนี้' : undefined}><LkSelect byId rows={lk.data?.UNIT} value={f.base_unit_id} onChange={(v) => set({ base_unit_id: v })} /></Field>
          {kind === 'stock' && <>
            <Field label="หน่วยใหญ่ / ตัวคูณ" hint="เช่น หีบ = 10 กล่อง (ใช้ในรายงาน)"><div className="pair"><LkSelect byId rows={lk.data?.UNIT} value={f.count_unit_id} onChange={(v) => set({ count_unit_id: v })} aria-label="หน่วยใหญ่" /><Dec value={f.count_factor} onChange={(v) => set({ count_factor: v })} aria-label="ตัวคูณหน่วยใหญ่" /></div></Field>
            <Field label="หน่วยซื้อ / ตัวคูณ"><div className="pair"><LkSelect byId rows={lk.data?.UNIT} value={f.purchase_unit_id} onChange={(v) => set({ purchase_unit_id: v })} aria-label="หน่วยซื้อ" /><Dec value={f.purchase_factor} onChange={(v) => set({ purchase_factor: v })} aria-label="ตัวคูณหน่วยซื้อ" /></div></Field>
            <Field label="หน่วยขาย / ตัวคูณ"><div className="pair"><LkSelect byId rows={lk.data?.UNIT} value={f.sales_unit_id} onChange={(v) => set({ sales_unit_id: v })} aria-label="หน่วยขาย" /><Dec value={f.sales_factor} onChange={(v) => set({ sales_factor: v })} aria-label="ตัวคูณหน่วยขาย" /></div></Field>
            <Field label="สินค้าทดแทน" hint="เสนอขายแทนเมื่อสินค้าหมด"><SearchPick endpoint="/api/v1/items" value={subst} label={(r: { name_th: string }) => r.name_th} exclude={id ? [id] : []} onPick={(r: { id: string; code: string; name_th: string } | null) => setSubst(r ? { id: r.id, code: r.code, name: r.name_th } : null)} /></Field>
            <Field label="ยอดคงเหลือติดลบได้?"><select value={f.allow_negative ?? ''} onChange={(e) => set({ allow_negative: e.target.value })}><option value="">ตามค่าเริ่มต้นบริษัท</option><option value="Y">Y ยอมให้ติดลบ</option><option value="N">N ไม่ยอมทุกกรณี</option><option value="A">A ยอมเมื่อผู้มีอำนาจอนุมัติ</option></select></Field>
            <Field label="ผู้จำหน่าย" hint="อ้างอิงเท่านั้น เช่น ผู้ให้ราคาดีที่สุด"><SearchPick endpoint="/api/v1/suppliers" value={sup} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => setSup(r)} /></Field>
            <Field label="บรรจุ/หีบห่อ"><input {...t('packing', 30)} /></Field>
          </>}
          <Field label="ประเภท VAT"><select value={f.vat_code ?? ''} onChange={(e) => set({ vat_code: e.target.value })}><option value="">ไม่ระบุ (ตามเอกสาร)</option><option value="1">อัตราปกติ</option><option value="0">ได้รับยกเว้น VAT</option></select></Field>
          {(kind === 'stock' || kind === 'kit') && <Field label="ราคาทุนมาตรฐาน" hint={kind === 'stock' ? 'ใช้เป็นต้นทุนเมื่อจ่ายขณะสต๊อกไม่พอ (ติดลบ)' : undefined}><Dec value={f.std_cost} onChange={(v) => set({ std_cost: v })} /></Field>}
          {priceLabel
            ? <Field label="จำนวนเงิน" hint={`ป้อนถ้า${kind === 'income' ? 'รับ' : 'จ่าย'}เท่ากันทุกครั้ง ว่าง = ป้อนตอนบันทึก`}><Dec value={f.price_1} onChange={(v) => set({ price_1: v })} /></Field>
            : <div className="field wide"><span className="lbl">ราคาขาย 1–5</span><div className="prices5">{[1, 2, 3, 4, 5].map((n) => <Dec key={n} value={f[`price_${n}`]} onChange={(v) => set({ [`price_${n}`]: v })} aria-label={`ราคาขาย ${n}`} placeholder={`ราคา ${n}`} />)}</div></div>}
          {kind === 'expense' && <Field label="บัญชีค่าใช้จ่าย" req hint="เดบิตเมื่อบันทึกค่าใช้จ่ายอื่น เช่น 5200-02 ค่าโฆษณา"><AccountCell value={acc.expense ?? null} onChange={(a) => setAcc((x) => ({ ...x, expense: a?.id ?? null }))} /></Field>}
          <Field label="หมายเหตุ" wide><textarea rows={2} value={f.remark ?? ''} maxLength={2000} onChange={(e) => set({ remark: e.target.value })} /></Field>
          {kind === 'stock' && id && cur.data && <div className="field wide party-stats">
            <span>ยอดคงเหลือ <b>{qtyFmt(cur.data.totals.qty)}</b></span>
            <span>ราคาต่อหน่วย <b><Money v={cur.data.totals.unit_cost} /></b></span>
            <span>มูลค่าคงเหลือ <b><Money v={cur.data.totals.value} /></b></span>
            <span className="muted small">ล็อตสินค้ายกมา (FIFO) ป้อนได้เมื่อมีระบบสินค้า (P4)</span>
          </div>}
        </div>}
        {tab === 'acc' && <div className="form-grid party-grid">
          <Field label="บัญชีรายได้" req hint="เครดิตเมื่อเปิดบิลขาย/บันทึกรายได้ เช่น 4100-01"><AccountCell value={acc.revenue ?? null} onChange={(a) => setAcc((x) => ({ ...x, revenue: a?.id ?? null }))} /></Field>
          <Field label={kind === 'income' ? 'บัญชีลดหนี้' : 'บัญชีรับคืน'} hint="เดบิตเมื่อเปิดใบลดหนี้ · ว่าง = ใช้บัญชีรายได้"><AccountCell value={acc.revenue_return ?? null} onChange={(a) => setAcc((x) => ({ ...x, revenue_return: a?.id ?? null }))} /></Field>
          <div className="field wide"><span className="lbl">ต้นทุนบริการ</span><span className="hint">0 = ไม่บันทึกบัญชีต้นทุน · ถ้าป้อนต้องเลือกบัญชีให้ครบทั้งสองบัญชี</span></div>
          <Field label="ต้นทุนบริการต่อหน่วย"><Dec value={f.std_cost} onChange={(v) => set({ std_cost: v })} /></Field>
          <Field label="Dr. บัญชีต้นทุนบริการ" hint="เช่น 5110-00"><AccountCell value={acc.cost_dr ?? null} onChange={(a) => setAcc((x) => ({ ...x, cost_dr: a?.id ?? null }))} /></Field>
          <Field label="Cr. บัญชีเงินเดือน/ค่าแรง" hint="เช่น 5310-01"><AccountCell value={acc.cost_cr ?? null} onChange={(a) => setAcc((x) => ({ ...x, cost_cr: a?.id ?? null }))} /></Field>
        </div>}
        {tab === 'bom' && <BomGrid rows={bom} onChange={setBom} selfId={id} units={lk.data?.UNIT} warehouses={lk.data?.WH} kitType={f.item_type ?? '1'} kitPrice={f.price_1 ?? null} />}
        {tab === 'wh' && cur.data && <div className="table-wrap">
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>คลัง</th><th>ชื่อคลัง</th><th className="r">คงเหลือ</th><th className="r">ราคาต่อหน่วย</th><th className="r">มูลค่าคงเหลือ</th><th className="r">ค้างรับ</th><th className="r">ค้างส่ง</th><th>ซื้อล่าสุด</th><th>ขายล่าสุด</th><th>ชั้นเก็บ</th></tr></thead>
            <tbody>
              {cur.data.warehouses.map((w) => <tr key={w.warehouse_id}><td className="mono">{w.warehouse_code}</td><td>{w.warehouse_name}</td><td className="r num">{qtyFmt(w.qty_on_hand)}</td><td className="r"><Money v={w.avg_cost} blankZero /></td><td className="r"><Money v={w.value_on_hand} /></td><td className="r num">{d(w.qty_on_order).isZero() ? '' : qtyFmt(w.qty_on_order)}</td><td className="r num">{d(w.qty_reserved).isZero() ? '' : qtyFmt(w.qty_reserved)}</td><td><DateText v={w.last_purchase_date} /></td><td><DateText v={w.last_sale_date} /></td><td>{w.shelf}</td></tr>)}
              {!cur.data.warehouses.length && <tr><td colSpan={10} className="empty">ยังไม่มีความเคลื่อนไหวในคลังใด</td></tr>}
            </tbody>
          </table>
        </div>}
        {tab === 'udf' && <div className="form-grid party-grid">
          {udfOn.map(([k, label]) => {
            const lab = udf[k]?.th || label;
            if (k === 'dat1' || k === 'dat2') { const col = k === 'dat1' ? 'udf_date_1' : 'udf_date_2'; return <Field key={k} label={lab}><DateInput value={f[col]} onChange={(v) => set({ [col]: v })} /></Field>; }
            if (k === 'num1') return <Field key={k} label={lab}><Dec value={f.udf_num_1} onChange={(v) => set({ udf_num_1: v })} /></Field>;
            const col = `udf_${k.slice(3)}`; const max = { str1: 4, str2: 4, str3: 15, str4: 30 }[k] ?? 30;
            return <Field key={k} label={lab}><input {...t(col, max)} /></Field>;
          })}
        </div>}
        {tab === 'img' && (id ? <ItemImagesTab path={K.path} itemId={id} canEdit={can('edit')} />
          : <p className="hint">บันทึก{K.label}ก่อน (F9) แล้วเปิดแก้ไขอีกครั้งเพื่อเพิ่มรูป</p>)}
        {tab === 'kits' && cur.data && <ul className="plain">{cur.data.used_in_kits.map((k) => <li key={k.id}><b className="mono">{k.code}</b> {k.name_th}</li>)}</ul>}
      </div>}
      {ask === 'delete' && <Confirm danger title={`ลบ${K.label}`} text={`ลบ ${f?.code}? ลบได้เฉพาะรหัสที่ยังไม่มีในเอกสาร ไม่มีสต๊อก และไม่อยู่ในสินค้าชุด — ถ้ามีแล้วให้เปลี่ยนสถานะเป็นเลิกใช้`} okText="ลบ" onClose={() => setAsk(null)} onOk={remove} />}
      {ask === 'copy' && <Confirm title="คัดลอกสินค้าชุด" text={<>สร้างชุดใหม่ที่เหมือน <b>{f?.code}</b> ทุกอย่าง ยกเว้นรหัส</>} okText="คัดลอก" onClose={() => setAsk(null)} onOk={copy}>
        <Field label="ตั้งรหัสใหม่เป็น" req><input autoFocus className="mono" value={copyCode} maxLength={30} onChange={(e) => setCopyCode(e.target.value.toUpperCase())} /></Field>
      </Confirm>}
      {showNotes && id && <MasterNotesDialog entity="item" id={id} title={f?.code ?? ''} canEdit={can('edit')} onClose={() => setShowNotes(false)} />}
    </Modal>
  );
}

/** รายการสินค้าประกอบ (คู่มือ S-IC-03: ราคาทุน/ราคาขายเริ่มจากราคาทุนมาตรฐาน/ราคาขาย 1 ของสินค้าประกอบ แก้ได้) */
function BomGrid({ rows, onChange, selfId, units, warehouses, kitType, kitPrice }: { rows: BomRow[]; onChange: (r: BomRow[]) => void; selfId: string | null; units?: Array<{ id?: string; code: string }>; warehouses?: Array<{ id?: string; code: string; name: string }>; kitType: string; kitPrice: string | null }): ReactNode {
  const set = (i: number, p: Partial<BomRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const sumCost = rows.reduce((s, r) => s.plus(d(r.qty || 0).times(d(r.std_cost || r.component_std_cost || 0))), d(0));
  const sumSell = rows.reduce((s, r) => s.plus(d(r.qty || 0).times(d(r.sell_price || r.component_price_1 || 0))), d(0));
  void units;
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th style={{ width: 40 }}>ที่</th><th style={{ width: 260 }}>รหัสสินค้าประกอบ</th><th>รายละเอียด</th><th className="r" style={{ width: 90 }}>จำนวน</th><th style={{ width: 60 }}>หน่วย</th><th className="r" style={{ width: 110 }}>ราคาทุน</th><th className="r" style={{ width: 110 }}>ราคาขาย</th><th style={{ width: 110 }}>คลังที่ตัด</th><th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td><SearchPick endpoint="/api/v1/items" value={r.component_item_id ? { id: r.component_item_id, code: r.component_code } : null} exclude={selfId ? [selfId] : []} aria-label={`สินค้าประกอบ ${i + 1}`}
                label={(x: { name_th: string }) => x.name_th}
                onPick={(x: { id: string; code: string; name_th: string; unit_code: string | null; std_cost: string | null; price_1: string | null } | null) => set(i, x ? { component_item_id: x.id, component_code: x.code, component_name: x.name_th, unit_code: x.unit_code, component_std_cost: x.std_cost, component_price_1: x.price_1, std_cost: r.std_cost || num(x.std_cost), sell_price: r.sell_price || num(x.price_1) } : { component_item_id: '', component_code: '' })} /></td>
              <td className="small">{r.component_name}</td>
              <td><Dec value={r.qty} onChange={(v) => set(i, { qty: v })} aria-label="จำนวน" /></td>
              <td>{r.unit_code}</td>
              <td><Dec value={r.std_cost} onChange={(v) => set(i, { std_cost: v })} aria-label="ราคาทุน" /></td>
              <td><Dec value={r.sell_price} onChange={(v) => set(i, { sell_price: v })} aria-label="ราคาขาย" /></td>
              <td><LkSelect byId rows={warehouses} value={r.warehouse_id} onChange={(v) => set(i, { warehouse_id: v || null })} blank="ตามเอกสาร" aria-label="คลังที่ตัด" /></td>
              <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => onChange(rows.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} className="empty">ยังไม่มีสินค้าประกอบ — ต้องมีในรายละเอียดสินค้าก่อน</td></tr>}
        </tbody>
        <tfoot><tr>
          <td colSpan={5}><button type="button" onClick={() => onChange([...rows, { component_item_id: '', component_code: '', component_name: '', unit_code: null, qty: '1', std_cost: '', sell_price: '', warehouse_id: null }])}>+ เพิ่มสินค้าประกอบ</button> <span className="hint">สินค้าประกอบ {rows.length} รายการ (สูงสุด 999)</span></td>
          <td className="r"><Money v={sumCost.toFixed(2)} /></td><td className="r"><Money v={sumSell.toFixed(2)} /></td><td colSpan={2} />
        </tr></tfoot>
      </table>
      <p className="hint">{kitType === '1'
        ? <>ชุดธรรมดา: ขายทั้งชุดแล้วตัดสต๊อกส่วนประกอบทุกตัว และเฉลี่ยราคาให้ส่วนประกอบตามสัดส่วน (ราคา × จำนวน){kitPrice && sumSell.gt(0) ? <> — ราคาชุด {d(kitPrice).toFixed(2)} เทียบผลรวมราคาขายส่วนประกอบ {sumSell.toFixed(2)}</> : null}</>
        : 'ชุดพิเศษ: เลือกขายเป็นชุดหรือเฉพาะบางรายการได้ตอนเปิดบิล ไม่เฉลี่ยราคา'}</p>
    </div>
  );
}
