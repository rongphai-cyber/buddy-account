import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { d, faAnnual, faRate, fmt, formatDate } from '@buddy/core';
import { api, type Department } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { NumInput, Confirm, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys, useYearSystem } from '../../ui';
import { DocLink } from '../../components/DocLink';

interface Group { id: string; code: string; name_th: string; name_en: string | null; asset_account_id: string | null; depr_expense_account_id: string | null; accum_depr_account_id: string | null; asset_count: number }
interface Row { id: string; code: string; name_th: string; category_code: string | null; group_code: string; purchase_date: string; cost: string; method: string; rate: string | null; status: string; sold_date: string | null; is_depreciable: boolean; accumulated: string; book_value: string }
interface Month { period_id: string; no: number; amount: string; posted: boolean; locked: boolean }
interface Detail {
  id: string; code: string; name_th: string; name_en: string | null; category_code: string | null; account_group_id: string; serial_no: string | null; department_id: string | null;
  is_depreciable: boolean; purchase_date: string; cost: string; salvage_value: string; method: string; start_date: string; useful_life_years: number | null; rate: string | null; end_date: string | null;
  depr_monthly: boolean; accum_depr_bf: string; accum_bf_date: string | null; manual_depr: string; manual_depr_to: string | null; sold_date: string | null; sold_amount: string | null; status: string;
  annual: string; accumulated: string; book_value: string; gain_loss: string | null; schedule: Array<{ fiscal_year: string; start: string; end: string; projected?: boolean; acc_before: string; total: string; months: Month[] }>;
}
const METHOD: Record<string, string> = { '0': 'ไม่คิดค่าเสื่อม', '1': 'วิธีเส้นตรง', '2': 'วิธีลดยอด' };
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(String(v)).toString());
const Dec = ({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; [k: string]: unknown }) =>
  <NumInput value={value} onChange={onChange} {...rest} />;
const useGroups = () => useQuery({ queryKey: ['asset-groups'], queryFn: () => api.get<Group[]>('/api/v1/asset-account-groups') });

/** ทะเบียนทรัพย์สินถาวร (คู่มือบทที่ 19 S-FA-01) */
export function AssetsPage() {
  const nav = useNavigate();
  const can = useCan('FA.ASSET');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'A' | 'S'>('A');
  const list = useQuery({ queryKey: ['fa-assets', q, status], queryFn: () => api.get<Row[]>('/api/v1/fa/assets', { q, status }) });
  useHotkeys({ Insert: can('add') ? () => nav('/fa/assets/new') : undefined }, []);
  const rows = list.data ?? [];
  const tot = (k: 'cost' | 'accumulated' | 'book_value') => rows.reduce((s, r) => s.plus(d(r[k])), d(0)).toFixed(2);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ทรัพย์สินถาวร" title="รายการทรัพย์สิน" lead="ทะเบียนทรัพย์สินและค่าเสื่อมราคา — โปรแกรมคิดค่าเสื่อมรายวันตามวิธีของ Express (เส้นตรง/ลดยอด) การซื้อ/ขายทรัพย์สินลงสมุดรายวันเอง"
        actions={can('add') && <button className="primary" onClick={() => nav('/fa/assets/new')}>+ เพิ่มทรัพย์สิน <kbd>Ins</kbd></button>} />
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหารหัส ชื่อ หรือเลขทะเบียน" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <select value={status} onChange={(e) => setStatus(e.target.value as 'A')} aria-label="สถานะ"><option value="A">ใช้งานอยู่</option><option value="S">ขาย/ตัดจำหน่ายแล้ว</option><option value="all">ทั้งหมด</option></select>
        <span className="muted small">{rows.length.toLocaleString()} รายการ</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 130 }}>รหัส</th><th>ชื่อทรัพย์สิน</th><th style={{ width: 60 }}>หมวด</th><th style={{ width: 70 }}>กลุ่มบัญชี</th><th style={{ width: 100 }}>วันที่ซื้อ</th><th style={{ width: 90 }}>วิธี</th>
            <th className="r" style={{ width: 130 }}>ราคาทุน</th><th className="r" style={{ width: 130 }}>ค่าเสื่อมสะสม</th><th className="r" style={{ width: 130 }}>มูลค่าตามบัญชี</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id} className="row-open" tabIndex={0} onClick={() => nav(`/fa/assets/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/fa/assets/${r.id}`)}>
              <td className="mono">{r.code}</td><td>{r.name_th}</td><td className="mono">{r.category_code}</td><td className="mono">{r.group_code}</td><td><DateText v={r.purchase_date} /></td>
              <td>{r.is_depreciable ? `${METHOD[r.method]} ${r.rate ? `${d(r.rate).toString()}%` : ''}` : 'ไม่คิด'}</td>
              <td className="r"><Money v={r.cost} /></td><td className="r"><Money v={r.accumulated} /></td><td className="r"><Money v={r.book_value} /></td>
              <td>{r.status === 'S' && <Pill tone="x">ขายแล้ว</Pill>}</td></tr>)}
            {list.data && !rows.length && <tr><td colSpan={10} className="empty">ไม่มีทรัพย์สินตามเงื่อนไข — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={6}>รวม</td><td className="r"><Money v={tot('cost')} /></td><td className="r"><Money v={tot('accumulated')} /></td><td className="r"><Money v={tot('book_value')} /></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'เปิด'], ['Esc', 'กลับ']]} />
    </div>
  );
}

type Form = Record<string, string | boolean>;
const EMPTY: Form = { code: '', name_th: '', name_en: '', category_code: '', account_group_id: '', serial_no: '', department_id: '', is_depreciable: true, purchase_date: '', cost: '', salvage_value: '1',
  method: '1', start_date: '', useful_life_years: '5', rate: '20', depr_monthly: true, accum_depr_bf: '0', accum_bf_date: '', manual_depr: '0', manual_depr_to: '' };

/** รายละเอียดทรัพย์สิน: แท็บรายละเอียด + ค่าเสื่อมรายเดือน (ปีปัจจุบัน/ปีถัดไป) · เปลี่ยนรหัส (S-FA-02) */
export function AssetFormPage() {
  const { id: rid } = useParams();
  const id = rid === 'new' ? undefined : rid;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('FA.ASSET');
  const ys = useYearSystem();
  const groups = useGroups();
  const lk = useLookups('52');
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const cur = useQuery({ enabled: !!id, queryKey: ['fa-asset', id], queryFn: () => api.get<Detail>(`/api/v1/fa/assets/${id}`), staleTime: 0 });
  const [f, setF] = useState<Form | null>(id ? null : { ...EMPTY });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('detail');
  const [err, setErr] = useState<unknown>(null);
  const [recode, setRecode] = useState<string | null>(null);
  const [askDel, setAskDel] = useState(false);
  const [sell, setSell] = useState<{ sold_date: string; sold_amount: string } | null>(null);
  const [askUnsell, setAskUnsell] = useState(false);
  const x = cur.data;
  const doSell = async () => {
    if (!sell) return;
    try {
      const r = await api.post<{ reposted: Array<{ period: string }> }>(`/api/v1/fa/assets/${id}/sell`, sell);
      toast(`บันทึกขายแล้ว${r.reposted.length ? ` — คิดค่าเสื่อมใหม่ ${r.reposted.length} งวด` : ''}`); setSell(null);
      qc.invalidateQueries({ queryKey: ['fa-asset', id] }); qc.invalidateQueries({ queryKey: ['fa-assets'] });
    } catch (e) { toastError(e); }
  };
  const doUnsell = async () => {
    setAskUnsell(false);
    try { await api.post(`/api/v1/fa/assets/${id}/unsell`, {}); toast('ยกเลิกการขายแล้ว'); qc.invalidateQueries({ queryKey: ['fa-asset', id] }); qc.invalidateQueries({ queryKey: ['fa-assets'] }); }
    catch (e) { toastError(e); }
  };
  useEffect(() => {
    if (!x) return;
    setF({ code: x.code, name_th: x.name_th, name_en: x.name_en ?? '', category_code: x.category_code ?? '', account_group_id: x.account_group_id, serial_no: x.serial_no ?? '', department_id: x.department_id ?? '',
      is_depreciable: x.is_depreciable, purchase_date: x.purchase_date, cost: num(x.cost), salvage_value: num(x.salvage_value), method: x.method === '0' ? '1' : x.method, start_date: x.start_date,
      useful_life_years: x.useful_life_years ? String(x.useful_life_years) : '', rate: num(x.rate), depr_monthly: x.depr_monthly, accum_depr_bf: num(x.accum_depr_bf), accum_bf_date: x.accum_bf_date ?? '',
      manual_depr: num(x.manual_depr), manual_depr_to: x.manual_depr_to ?? '' });
    setDirty(false);
  }, [x]);
  const set = (p: Form) => { setF((v) => ({ ...v!, ...p })); setDirty(true); };
  const readOnly = !!id && !can('edit');
  const s = (k: string) => String(f?.[k] ?? '');
  const annual = f ? faAnnual({ method: s('method'), is_depreciable: !!f.is_depreciable, cost: s('cost') || 0, salvage_value: s('salvage_value') || 0, rate: s('rate') || null, useful_life_years: Number(s('useful_life_years')) || null,
    start_date: s('start_date'), depr_monthly: !!f.depr_monthly, manual_depr: s('manual_depr') || 0 }, s('accum_depr_bf') || 0).toFixed(2) : '';
  const save = async () => {
    if (!f || readOnly || !can(id ? 'edit' : 'add')) return;
    setErr(null);
    const body = { ...f, name_en: s('name_en') || null, category_code: s('category_code') || null, serial_no: s('serial_no') || null, department_id: s('department_id') || null,
      useful_life_years: s('useful_life_years') || null, rate: s('rate') || null, accum_bf_date: s('accum_bf_date') || null, manual_depr_to: s('manual_depr_to') || null,
      cost: s('cost') || '0', salvage_value: s('salvage_value') || '0', accum_depr_bf: s('accum_depr_bf') || '0', manual_depr: s('manual_depr') || '0' };
    try {
      const r = id ? await api.put<{ id: string; code: string }>(`/api/v1/fa/assets/${id}`, body) : await api.post<{ id: string; code: string }>('/api/v1/fa/assets', body);
      toast(`บันทึกทรัพย์สิน ${r.code} แล้ว`); setDirty(false);
      qc.invalidateQueries({ queryKey: ['fa-assets'] }); qc.invalidateQueries({ queryKey: ['fa-asset', r.id] });
      if (!id) nav(`/fa/assets/${r.id}`, { replace: true });
    } catch (e) { setErr(e); }
  };
  const doRecode = async () => {
    if (!id || recode === null) return;
    try { const r = await api.post<{ code: string }>(`/api/v1/fa/assets/${id}/recode`, { code: recode }); toast(`เปลี่ยนรหัสเป็น ${r.code} แล้ว`); setRecode(null); qc.invalidateQueries({ queryKey: ['fa-asset', id] }); qc.invalidateQueries({ queryKey: ['fa-assets'] }); }
    catch (e) { toastError(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav('/fa/assets'); } }, []);
  const sold = !!x?.sold_date;
  return (
    <div className="page" data-tone="gl">
      <div className="doc-title"><p className="eyebrow">บัญชี › รายการทรัพย์สิน</p><h1 className="mono">{id ? x?.code : 'ทรัพย์สินใหม่'}</h1>
        <span className="doc-state">{sold ? <Pill tone="x">ขาย/ตัดจำหน่าย <DateText v={x?.sold_date} /></Pill> : id ? <Pill tone="n">ใช้งานอยู่</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setF({ ...EMPTY }); nav('/fa/assets/new'); } }}>+ ใหม่</button>
        <button className="primary" disabled={readOnly || !f} onClick={save}>บันทึก <kbd>F9</kbd></button>
        <button disabled={!id || !can('edit')} onClick={() => setRecode(x?.code ?? '')} title="เปลี่ยนรหัสทรัพย์สิน (S-FA-02)">เปลี่ยนรหัส</button>
        {!x?.sold_date ? <button disabled={!id || !can('edit')} onClick={() => setSell({ sold_date: '', sold_amount: '' })} title="บันทึกขายทรัพย์สิน (SOLD F/A)">บันทึกขาย</button>
          : <button disabled={!can('cancel')} onClick={() => setAskUnsell(true)}>ยกเลิกการขาย</button>}
        <button disabled={!id || !can('delete')} onClick={() => setAskDel(true)}>ลบ</button>
        <button onClick={() => nav('/fa/assets')}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error} />
      {f && <div onKeyDown={navKey}>
        <div className="form-grid">
          <Field label="รหัส" req hint={id ? 'แก้รหัสด้วยปุ่ม "เปลี่ยนรหัส"' : undefined}><input className="mono" autoFocus={!id} value={s('code')} maxLength={30} disabled={!!id} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="ชื่อไทย" req wide><input value={s('name_th')} maxLength={120} disabled={readOnly} onChange={(e) => set({ name_th: e.target.value })} /></Field>
          <Field label="ชื่ออังกฤษ" wide><input value={s('name_en')} maxLength={120} disabled={readOnly} onChange={(e) => set({ name_en: e.target.value })} /></Field>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'detail', label: 'รายละเอียด' }, ...(id ? [{ key: 'depr', label: 'ค่าเสื่อมรายเดือน' }] : [])]} />
        {tab === 'detail' && <div className="fa-grid">
          <fieldset className="box"><legend>ทรัพย์สิน</legend>
            <Field label="หมวด"><LkSelect rows={lk.data?.['52']} value={s('category_code')} disabled={readOnly} onChange={(v) => set({ category_code: v })} /></Field>
            <Field label="กลุ่มบัญชี" req hint="กำหนดบัญชีค่าเสื่อม/ค่าเสื่อมสะสม"><select value={s('account_group_id')} disabled={readOnly} onChange={(e) => set({ account_group_id: e.target.value })}><option value="">—</option>
              {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.code} {g.name_th}</option>)}</select></Field>
            <Field label="เลขทะเบียน"><input value={s('serial_no')} maxLength={40} disabled={readOnly} onChange={(e) => set({ serial_no: e.target.value })} /></Field>
            <Field label="แผนก"><select value={s('department_id')} disabled={readOnly} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.map((x2) => <option key={x2.id} value={x2.id}>{x2.code} {x2.name_th}</option>)}</select></Field>
          </fieldset>
          <fieldset className="box"><legend>ราคาและวิธีคิดค่าเสื่อม</legend>
            <label className="check"><input type="checkbox" checked={!!f.is_depreciable} disabled={readOnly} onChange={(e) => set({ is_depreciable: e.target.checked })} /> คิดค่าเสื่อม (ไม่ติ๊ก = ที่ดิน หรือยังไม่ต้องการคิด)</label>
            <Field label="วันที่ซื้อ" req><DateInput value={s('purchase_date')} disabled={readOnly} onChange={(v) => set({ purchase_date: v, ...(!s('start_date') ? { start_date: v } : {}) })} /></Field>
            <Field label="ราคาทุน" req><Dec value={s('cost')} disabled={readOnly} onChange={(v) => set({ cost: v })} /></Field>
            <Field label="ราคาซาก" req hint="อย่างน้อย 1 บาท · ส่วนที่เกินเพดานกฎหมาย (เช่น รถยนต์นั่งเกิน 1 ล้าน) ใส่ที่นี่"><Dec value={s('salvage_value')} disabled={readOnly} onChange={(v) => set({ salvage_value: v })} /></Field>
            <Field label="วิธีคิดค่าเสื่อม"><select value={s('method')} disabled={readOnly || !f.is_depreciable} onChange={(e) => set({ method: e.target.value })}><option value="1">วิธีเส้นตรง</option><option value="2">วิธีลดยอด</option></select></Field>
            <Field label="วันที่เริ่มใช้" req hint="เริ่มคิดค่าเสื่อมตั้งแต่วันนี้"><DateInput value={s('start_date')} disabled={readOnly} onChange={(v) => set({ start_date: v })} /></Field>
            <Field label="อายุการใช้งาน (ปี) / อัตรา (%)"><div className="pair"><input type="number" min={0} max={100} value={s('useful_life_years')} disabled={readOnly} aria-label="อายุการใช้งาน"
              onChange={(e) => set({ useful_life_years: e.target.value, ...(Number(e.target.value) ? { rate: faRate({ rate: null, useful_life_years: Number(e.target.value) }).toString() } : {}) })} />
              <Dec value={s('rate')} disabled={readOnly} onChange={(v) => set({ rate: v })} aria-label="อัตรา" /></div></Field>
          </fieldset>
          <fieldset className="box"><legend>การคิดค่าเสื่อม</legend>
            <Field label="คิดค่าเสื่อม"><select value={f.depr_monthly ? 'M' : 'Y'} disabled={readOnly} onChange={(e) => set({ depr_monthly: e.target.value === 'M' })}><option value="M">รายเดือน</option><option value="Y">รายปี (ลงงวดสุดท้าย)</option></select></Field>
            <Field label="ค่าเสื่อมสะสมยกมา / ณ วันที่" hint="ใช้เมื่อไม่ได้เริ่มใช้โปรแกรมในปีแรกของทรัพย์สิน — ยอดสะสมถึงก่อนวันที่นี้"><div className="pair"><Dec value={s('accum_depr_bf')} disabled={readOnly} onChange={(v) => set({ accum_depr_bf: v })} aria-label="ค่าเสื่อมสะสมยกมา" />
              <DateInput value={s('accum_bf_date')} disabled={readOnly} onChange={(v) => set({ accum_bf_date: v })} /></div></Field>
            <Field label="ค่าเสื่อมที่คำนวณเอง / ถึงวันที่" hint="เริ่มใช้โปรแกรมระหว่างปี: ค่าเสื่อมตั้งแต่ต้นปีถึงวันที่นี้ (ว่าง = ลงงวดที่เริ่มใช้)"><div className="pair"><Dec value={s('manual_depr')} disabled={readOnly} onChange={(v) => set({ manual_depr: v })} aria-label="ค่าเสื่อมที่คำนวณเอง" />
              <DateInput value={s('manual_depr_to')} disabled={readOnly} onChange={(v) => set({ manual_depr_to: v })} /></div></Field>
            <Field label="ค่าเสื่อมเบื้องต้น (ต่อปี)"><input className="r" readOnly value={fmt(annual)} tabIndex={-1} /></Field>
            {id && x && <>
              <Field label="ค่าเสื่อมสะสม (ลงบัญชีแล้ว) / มูลค่าตามบัญชี"><div className="pair"><input className="r" readOnly tabIndex={-1} value={fmt(x.accumulated)} /><input className="r" readOnly tabIndex={-1} value={fmt(x.book_value)} /></div></Field>
              {x.sold_date && <Field label="วันที่ขาย / ราคาขาย / กำไร(ขาดทุน)"><div className="pair three"><input readOnly tabIndex={-1} value={formatDate(x.sold_date, ys)} /><input className="r" readOnly tabIndex={-1} value={x.sold_amount ? fmt(x.sold_amount) : ''} /><input className="r" readOnly tabIndex={-1} value={x.gain_loss ? fmt(x.gain_loss) : ''} /></div></Field>}
            </>}
          </fieldset>
        </div>}
        {tab === 'depr' && x && <div className="table-wrap">
          <p className="hint">{METHOD[x.method]} {x.rate ? `อัตรา ${d(x.rate).toString()}%` : ''} · ค่าเสื่อมต่อปี {fmt(x.annual)} · งวดที่ลงบัญชีแล้วแสดงยอดที่ลงจริง งวดที่ยังไม่ลงแสดงยอดที่คำนวณ (ลงบัญชีที่ "คิดค่าเสื่อม-ลงบัญชี")</p>
          <table className="grid" style={{ maxWidth: 640 }}>
            <thead><tr><th style={{ width: 70 }}>งวด</th>{x.schedule.map((y) => <th key={y.fiscal_year} className="r" title={y.projected ? 'ยังไม่ได้กำหนดรอบบัญชีปีนี้ — ประมาณการ' : undefined}>ปี {y.fiscal_year}{y.projected ? ' (ประมาณการ)' : ''}</th>)}</tr></thead>
            <tbody>
              <tr className="muted"><td>มูลค่าต้นงวด</td>{x.schedule.map((y) => <td key={y.fiscal_year} className="r num">{fmt(d(x.cost).minus(y.acc_before).toFixed(2))}</td>)}</tr>
              {Array.from({ length: 12 }, (_, i) => <tr key={i}><td>{i + 1}</td>{x.schedule.map((y) => { const m = y.months[i]!; return <td key={y.fiscal_year} className="r num" title={m.posted ? 'ลงบัญชีแล้ว' : 'คำนวณ (ยังไม่ลงบัญชี)'}>{fmt(m.amount, { blankZero: true })}{m.posted ? ' ✓' : ''}</td>; })}</tr>)}
            </tbody>
            <tfoot><tr><td>รวม</td>{x.schedule.map((y) => <td key={y.fiscal_year} className="r">{fmt(y.total)}</td>)}</tr></tfoot>
          </table>
        </div>}
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F9', 'บันทึก'], ['Esc', 'กลับรายการ']]} />
      {recode !== null && <Modal title="เปลี่ยนรหัสทรัพย์สิน" size="confirm" onClose={() => setRecode(null)} footer={<><button onClick={() => setRecode(null)}>ยกเลิก</button><button className="primary" onClick={doRecode}>ตกลง</button></>}>
        <div className="form-grid"><Field label="รหัสเดิม"><input className="mono" readOnly value={x?.code ?? ''} /></Field><Field label="เปลี่ยนเป็น" req><input className="mono" autoFocus value={recode} maxLength={30} onChange={(e) => setRecode(e.target.value.toUpperCase())} /></Field></div>
      </Modal>}
      {sell && <Modal title="บันทึกขายทรัพย์สิน" size="confirm" onClose={() => setSell(null)} footer={<><button onClick={() => setSell(null)}>ยกเลิก</button><button className="primary" onClick={doSell}>ตกลง</button></>}>
        <p className="small muted">ค่าเสื่อมคิดถึงวันที่ขาย — โปรแกรมไม่ลงบัญชีการขาย ให้บันทึกในสมุดรายวันเอง (Dr เงินสด, ค่าเสื่อมสะสม / Cr ทรัพย์สิน, กำไร-ขาดทุนจากการจำหน่าย)</p>
        <div className="form-grid" onKeyDown={navKey}><Field label="วันที่ขาย" req><DateInput value={sell.sold_date} onChange={(v) => setSell({ ...sell, sold_date: v })} autoFocus /></Field>
          <Field label="ราคาขาย" req><Dec value={sell.sold_amount} onChange={(v) => setSell({ ...sell, sold_amount: v })} /></Field></div>
      </Modal>}
      {askUnsell && <Confirm title="ยกเลิกการขาย" text={`ยกเลิกการขายทรัพย์สิน ${x?.code}? งวดที่ลงค่าเสื่อมแล้วหลังวันขายจะคิดใหม่`} onClose={() => setAskUnsell(false)} onOk={doUnsell} />}
      {askDel && <Confirm danger title="ลบทรัพย์สิน" text={`ลบทรัพย์สิน ${x?.code}? ลบได้เฉพาะรายการที่ยังไม่ได้ลงค่าเสื่อม`} okText="ลบ" onClose={() => setAskDel(false)}
        onOk={() => api.del(`/api/v1/fa/assets/${id}`).then(() => { toast('ลบทรัพย์สินแล้ว'); qc.invalidateQueries({ queryKey: ['fa-assets'] }); nav('/fa/assets'); }).catch((e) => { setAskDel(false); toastError(e); })} />}
    </div>
  );
}

/** กำหนดกลุ่มบัญชีทรัพย์สิน (คู่มือบทที่ 5 S-SET-12) */
export function AssetAccountGroupsPage() {
  const can = useCan('SET.FAG');
  const qc = useQueryClient();
  const list = useGroups();
  const [edit, setEdit] = useState<Group | 'new' | null>(null);
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › กลุ่มบัญชีทรัพย์สิน" title="กำหนดกลุ่มบัญชีทรัพย์สิน" lead="บัญชีทรัพย์สิน บัญชีค่าเสื่อมราคา (Dr.) และค่าเสื่อมราคาสะสม (Cr.) ที่ใช้ลงค่าเสื่อมอัตโนมัติ — ผูกกลุ่มกับทรัพย์สินแต่ละรายการ"
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มกลุ่มบัญชี <kbd>Ins</kbd></button>} />
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 90 }}>รหัส</th><th>คำอธิบาย</th><th>คำอธิบาย (อังกฤษ)</th><th className="r" style={{ width: 110 }}>ทรัพย์สิน</th></tr></thead>
          <tbody>
            {list.data?.map((g) => <tr key={g.id} className="row-open" tabIndex={0} onClick={() => setEdit(g)} onKeyDown={(e) => e.key === 'Enter' && setEdit(g)}>
              <td className="mono">{g.code}</td><td>{g.name_th}</td><td className="muted">{g.name_en}</td><td className="r">{Number(g.asset_count).toLocaleString()}</td></tr>)}
            {list.data && !list.data.length && <tr><td colSpan={4} className="empty">ยังไม่มีกลุ่มบัญชีทรัพย์สิน — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <AssetGroupForm g={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['asset-groups'] }); }} />}
    </div>
  );
}
const GROUP_ACC: Array<[keyof Group, string, string]> = [['asset_account_id', 'บัญชีทรัพย์สิน', 'เช่น 1410-05 ยานพาหนะ'], ['depr_expense_account_id', 'บ/ช ค่าเสื่อม (Dr.)', 'เช่น 5340-05 ค่าเสื่อมราคา-ยานพาหนะ'], ['accum_depr_account_id', 'ค่าเสื่อมสะสม (Cr.)', 'เช่น 1420-05 ค่าเสื่อมราคาสะสม-ยานพาหนะ']];
function AssetGroupForm({ g, onClose, onSaved }: { g: Group | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan('SET.FAG');
  const [f, setF] = useState<Record<string, string | null>>(g ? { code: g.code, name_th: g.name_th, name_en: g.name_en, asset_account_id: g.asset_account_id, depr_expense_account_id: g.depr_expense_account_id, accum_depr_account_id: g.accum_depr_account_id } : { code: '', name_th: '', name_en: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState(false);
  const allowed = can(g ? 'edit' : 'add');
  const save = async () => {
    if (!allowed) return;
    setErr(null);
    const body = { code: f.code, name_th: f.name_th, name_en: f.name_en || null, ...Object.fromEntries(GROUP_ACC.map(([k]) => [k, f[k] || null])) };
    try { if (g) await api.put(`/api/v1/asset-account-groups/${g.id}`, body); else await api.post('/api/v1/asset-account-groups', body); toast(`บันทึกกลุ่มบัญชี ${String(f.code).toUpperCase()} แล้ว`); onSaved(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  return (
    <Modal title={g ? `แก้ไขกลุ่มบัญชี ${g.code}` : 'เพิ่มกลุ่มบัญชีทรัพย์สิน'} onClose={onClose}
      footer={<>{g && can('delete') && <button className="danger" onClick={() => setAsk(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!allowed} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="รหัส" req hint="เช่น CAR0"><input autoFocus className="mono" value={f.code ?? ''} maxLength={10} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="คำอธิบายไทย" req><input value={f.name_th ?? ''} maxLength={120} onChange={(e) => setF({ ...f, name_th: e.target.value })} placeholder="ค่าเสื่อมราคา-ยานพาหนะ" /></Field>
        <Field label="คำอธิบายอังกฤษ"><input value={f.name_en ?? ''} maxLength={120} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        {GROUP_ACC.map(([k, label, hint], i) => <Field key={k} label={label} req={i > 0} hint={hint}><AccountCell value={f[k] ?? null} onChange={(a) => setF((x) => ({ ...x, [k]: a?.id ?? null }))} /></Field>)}
      </div>
      {ask && g && <Confirm danger title="ลบกลุ่มบัญชี" text={`ลบกลุ่มบัญชี ${g.code}? ลบได้เฉพาะกลุ่มที่ไม่มีทรัพย์สินใช้อยู่`} okText="ลบ" onClose={() => setAsk(false)}
        onOk={() => api.del(`/api/v1/asset-account-groups/${g.id}`).then(() => { toast('ลบกลุ่มบัญชีแล้ว'); onSaved(); }).catch((e) => { setAsk(false); toastError(e); })} />}
    </Modal>
  );
}

interface DepPeriod { id: string; period_no: number; start_date: string; end_date: string; is_locked: boolean; fiscal_year: string; n: string | null; total: string | null; voucher_no: string | null; journal_id: string | null; unposted: string | null }
type DepResult = Array<{ period: string; voucher_no: string | null; total: string; changed: boolean }>;
/** คิดค่าเสื่อม-ลงบัญชี (S-FA-04): เลือกงวด → คำนวณใหม่และลงบัญชีแทนของเดิม (RECAL F/A) หรือลงบัญชีเฉพาะที่ยังไม่มีใบสำคัญ (REJNL) */
export function DepreciationPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const can = useCan('FA.DEPR');
  const list = useQuery({ queryKey: ['fa-dep-periods'], queryFn: () => api.get<DepPeriod[]>('/api/v1/fa/depreciation-periods') });
  const years = [...new Set((list.data ?? []).map((p) => p.fiscal_year))];
  const [fy, setFy] = useState('');
  useEffect(() => { if (!fy && years.length) setFy(years.at(-1)!); }, [years, fy]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'recalc' | 'post' | null>(null);
  const [res, setRes] = useState<DepResult | null>(null);
  const rows = (list.data ?? []).filter((p) => p.fiscal_year === fy);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async (mode: 'recalc' | 'post') => {
    setAsk(null); setBusy(true);
    try {
      const r = await api.post<{ periods: DepResult }>('/api/v1/fa/depreciate', { period_ids: [...sel], mode });
      setRes(r.periods); toast('คิดค่าเสื่อม-ลงบัญชีเสร็จแล้ว');
      qc.invalidateQueries({ queryKey: ['fa-dep-periods'] }); qc.invalidateQueries({ queryKey: ['fa-asset'] }); qc.invalidateQueries({ queryKey: ['fa-assets'] });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ทรัพย์สินถาวร" title="คิดค่าเสื่อม-ลงบัญชี" lead="เลือกงวดแล้วคิดค่าเสื่อมทุกทรัพย์สิน — ลงใบสำคัญ Dr ค่าเสื่อมราคา / Cr ค่าเสื่อมราคาสะสม ตามกลุ่มบัญชี งวดละ 1 ใบ (เลขที่ FAปปดดนนนน) · คิดใหม่แล้วยอดเปลี่ยน จะยกเลิกใบเดิมและออกใบใหม่" />
      <div className="toolbar">
        <label>ปีบัญชี <select value={fy} onChange={(e) => { setFy(e.target.value); setSel(new Set()); }}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button onClick={() => setSel(new Set(rows.filter((p) => !p.is_locked).map((p) => p.id)))}>เลือกทุกงวด</button>
        <button className="primary" disabled={!can('add') || !sel.size || busy} onClick={() => setAsk('recalc')}>คิดค่าเสื่อม-ลงบัญชี ({sel.size} งวด)</button>
        <button disabled={!can('add') || !sel.size || busy} onClick={() => setAsk('post')} title="ลงบัญชีค่าเสื่อมที่คำนวณไว้แล้วแต่ยังไม่มีใบสำคัญ — ไม่คำนวณใหม่">ลงบัญชีใหม่ (ไม่คำนวณ)</button>
        <button onClick={() => nav('/fa/assets')}>รายการทรัพย์สิน</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid" style={{ maxWidth: 860 }}>
          <thead><tr><th style={{ width: 40 }} /><th style={{ width: 60 }}>งวด</th><th>ช่วงวันที่</th><th className="r">ทรัพย์สิน</th><th className="r">ค่าเสื่อมที่ลงแล้ว</th><th>ใบสำคัญ</th><th /></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id} className={p.is_locked ? 'cancelled' : 'row-open'} onClick={() => !p.is_locked && toggle(p.id)}>
            <td className="c"><input type="checkbox" checked={sel.has(p.id)} disabled={p.is_locked} readOnly aria-label={`งวด ${p.period_no}`} /></td><td>{p.period_no}</td><td><DateText v={p.start_date} /> – <DateText v={p.end_date} /></td>
            <td className="r">{p.n ? Number(p.n).toLocaleString() : ''}</td><td className="r"><Money v={p.total} blankZero /></td><td><DocLink id={p.journal_id} no={p.voucher_no} cls="GL" /></td>
            <td>{p.is_locked ? <Pill tone="d">ปิดงวดแล้ว</Pill> : Number(p.unposted ?? 0) > 0 ? <Pill tone="c">ยังไม่ลงบัญชี {p.unposted}</Pill> : p.n ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : null}</td></tr>)}</tbody>
        </table>
      </div>
      {res && <div className="note-box"><p><b>ผลการคิดค่าเสื่อม</b></p><ul className="small">{res.map((r) => <li key={r.period}>งวด {r.period}: {r.changed ? `ลงบัญชี ${r.voucher_no ?? '(ไม่มีค่าเสื่อม)'} ยอด ${fmt(r.total)}` : `ไม่มีการเปลี่ยนแปลง (ยอด ${fmt(r.total)})`}</li>)}</ul></div>}
      {ask && <Confirm title={ask === 'recalc' ? 'คิดค่าเสื่อม-ลงบัญชี' : 'ลงบัญชีใหม่'} text={ask === 'recalc' ? `คำนวณค่าเสื่อมใหม่ ${sel.size} งวด — งวดที่ยอดเปลี่ยนจะยกเลิกใบสำคัญเดิมและออกใบใหม่` : `ลงบัญชีค่าเสื่อมที่ยังไม่มีใบสำคัญ ${sel.size} งวด`} onOk={() => run(ask)} onClose={() => setAsk(null)} />}
    </div>
  );
}
