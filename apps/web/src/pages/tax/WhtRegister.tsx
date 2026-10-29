import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, todayIso, WHT_INCOME_TYPES } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, toast, useHotkeys, useYearSystem } from '../../ui';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const FORM_TH: Record<string, string> = { S03: 'ภ.ง.ด.3', S53: 'ภ.ง.ด.53' };
const COND_TH: Record<string, string> = { '1': 'หัก ณ ที่จ่าย', '2': 'ออกให้ตลอดไป', '3': 'ออกให้ครั้งเดียว' };
/** เอกสารต้นทางที่เปิดได้จากแฟ้ม */
const DOC_ROUTE: Record<string, string> = { PS: '/fi/ap/payments' };

interface Row { id: string; form_type: string; certificate_no: string | null; certificate_date: string; tax_month: string; is_late: boolean; payee_name: string; payee_tax_id: string | null; income_type: string | null;
  paid_amount: string; rate: string; tax_amount: string; condition: string | null; doc_status: string; print_count: number; header_id: string | null; doc_no: string | null; doc_class: string | null }
interface Entry { id?: string; form_type: 'S03' | 'S53'; certificate_no: string; certificate_date: string; is_late: boolean; supplier: { id: string; code: string; name?: string | null } | null; payee_name: string; payee_address: string; payee_tax_id: string; payee_tax_branch_no: string;
  income_type: string; condition: '1' | '2' | '3'; paid_amount: string; rate: string; tax_amount: string; header_id: string | null; doc_no: string | null; doc_class: string | null; doc_status: string }

/** แฟ้มภาษีหัก ณ ที่จ่าย (คู่มือบทที่ 16 S-TX-09/10) — รายการจากใบสำคัญจ่าย + เพิ่มเอง · พิมพ์ 50 ทวิ จากรายการ */
export function WhtRegisterPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('FI.WHT');
  const ys = useYearSystem();
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [form, setForm] = useState<'S03' | 'S53' | 'all'>('S53');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [status, setStatus] = useState<'N' | 'C' | 'all'>('N');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Entry | null>(null);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const list = useQuery({ queryKey: ['wht', form, ym, status, q], queryFn: () => api.get<{ rows: Row[]; total_paid: string; total_tax: string }>('/api/v1/wht', { form, month: ym, status, q }), placeholderData: (p) => p });
  const blank = (): Entry => ({ form_type: form === 'S03' ? 'S03' : 'S53', certificate_no: '', certificate_date: today.slice(0, 7) === ym ? today : `${ym}-01`, is_late: false, supplier: null, payee_name: '', payee_address: '', payee_tax_id: '', payee_tax_branch_no: '',
    income_type: 'ค่าบริการ', condition: '1', paid_amount: '', rate: '3', tax_amount: '', header_id: null, doc_no: null, doc_class: null, doc_status: 'N' });
  const openRow = async (r: Row) => {
    const w = await api.get<Record<string, string | null> & { is_late: boolean }>(`/api/v1/wht/${r.id}`);
    setEdit({ id: r.id, form_type: (w.form_type === 'S03' ? 'S03' : 'S53'), certificate_no: w.certificate_no ?? '', certificate_date: String(w.certificate_date).slice(0, 10), is_late: !!w.is_late,
      supplier: w.supplier_id ? { id: w.supplier_id, code: '' } : null, payee_name: w.payee_name ?? '', payee_address: w.payee_address ?? '', payee_tax_id: w.payee_tax_id ?? '', payee_tax_branch_no: w.payee_tax_branch_no ?? '',
      income_type: w.income_type ?? '', condition: (['1', '2', '3'].includes(w.condition ?? '') ? w.condition : '1') as Entry['condition'], paid_amount: d(w.paid_amount ?? 0).toString(), rate: d(w.rate ?? 0).toString(), tax_amount: d(w.tax_amount ?? 0).toString(),
      header_id: w.header_id ?? null, doc_no: w.doc_no ?? null, doc_class: w.doc_class ?? null, doc_status: w.doc_status ?? 'N' });
  };
  useHotkeys({ Insert: can('add') && !edit ? () => setEdit(blank()) : undefined }, []);
  const years = Array.from({ length: 7 }, (_, i) => Number(today.slice(0, 4)) - 5 + i);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="การเงิน › ภาษีหัก ณ ที่จ่าย" title="แฟ้มภาษีหัก ณ ที่จ่าย"
        lead="รายการเกิดจากใบสำคัญจ่ายชำระหนี้อัตโนมัติ (ยอดเงินแก้ที่เอกสารต้นทาง) หรือเพิ่มเองในแฟ้ม · คลิกรายการเพื่อแก้เลขที่หนังสือรับรอง หรือพิมพ์ 50 ทวิ"
        actions={<>{can('add') && <button className="primary" onClick={() => setEdit(blank())}>+ เพิ่มรายการ <kbd>Ins</kbd></button>}<button onClick={() => nav('/tax/wht50')}>🖨 พิมพ์ 50 ทวิ (ป้อนเอง)</button>
          {form !== 'all' && <button title="ข้อความคั่นด้วย | สำหรับนำเข้าโปรแกรมยื่นแบบของกรมสรรพากร (ตรวจกับโปรแกรมก่อนยื่นจริง)" onClick={async () => {
            try {
              const res = await fetch(`/api/v1/wht/efile?form=${form}&month=${ym}`, { credentials: 'include' });
              if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'ส่งออกไม่สำเร็จ'); }
              const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = `${form === 'S03' ? 'PND3' : 'PND53'}_${ym.replace('-', '')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            } catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); }
          }}>⬇ ไฟล์ยื่นทางอินเทอร์เน็ต</button>}
          {form !== 'all' && <button onClick={() => nav(`/reports/center?g=6`)}>ใบแนบ {FORM_TH[form]}</button>}</>} />
      <div className="toolbar">
        <div className="seg">{(['S53', 'S03', 'all'] as const).map((f) => <button key={f} className={cx(form === f && 'on')} onClick={() => setForm(f)}>{f === 'all' ? 'ทุกแบบ' : FORM_TH[f]}</button>)}</div>
        <label>งวด <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="เดือน">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="ปี">{years.map((y) => <option key={y} value={y}>{ys === 'B' ? y + 543 : y}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'N')} aria-label="สถานะ"><option value="N">ปกติ</option><option value="C">ยกเลิก</option><option value="all">ทุกสถานะ</option></select>
        <input type="search" placeholder="ค้นหาผู้ถูกหัก เลขที่ เลขผู้เสียภาษี" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 80 }}>แบบ</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 130 }}>เลขที่หนังสือรับรอง</th><th>ผู้ถูกหักภาษี</th><th style={{ width: 140 }}>เลขผู้เสียภาษี</th><th style={{ width: 150 }}>ประเภทเงินได้</th>
            <th className="r" style={{ width: 70 }}>อัตรา</th><th className="r" style={{ width: 130 }}>ยอดจ่าย</th><th className="r" style={{ width: 120 }}>หักไว้</th><th style={{ width: 130 }}>เอกสาร</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => openRow(r)} onKeyDown={(e) => e.key === 'Enter' && openRow(r)}>
                <td>{FORM_TH[r.form_type] ?? r.form_type}</td><td><DateText v={r.certificate_date} /></td><td className="mono">{r.certificate_no}</td><td>{r.payee_name}</td><td className="mono">{r.payee_tax_id}</td><td>{r.income_type}</td>
                <td className="r">{d(r.rate).toString()}%</td><td className="r"><Money v={r.paid_amount} /></td><td className="r"><Money v={r.tax_amount} /></td><td className="mono">{r.doc_no ?? <span className="muted">เพิ่มเอง</span>}</td>
                <td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : r.is_late ? <Pill tone="c">ยื่นเพิ่มเติม</Pill> : r.print_count > 0 ? <Pill tone="n">พิมพ์แล้ว</Pill> : <Pill tone="m">ยังไม่พิมพ์</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={11} className="empty">ไม่มีรายการในงวดนี้</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={7} className="r">รวม {list.data.rows.length} รายการ</td><td className="r"><b><Money v={list.data.total_paid} /></b></td><td className="r"><b><Money v={list.data.total_tax} /></b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['คลิก/Enter', 'แก้ไข / พิมพ์ 50 ทวิ']]} />
      {edit && <WhtEditor entry={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['wht'] }); }} />}
    </div>
  );
}

function WhtEditor({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const nav = useNavigate();
  const can = useCan('FI.WHT');
  const [e, setE] = useState(entry);
  const [err, setErr] = useState<unknown>(null);
  const [askCancel, setAskCancel] = useState(false);
  const fromDoc = !!e.header_id;
  const ro = e.doc_status === 'C' || !can(e.id ? 'edit' : 'add');
  const set = (p: Partial<Entry>) => setE((x) => {
    const n = { ...x, ...p };
    if ((p.paid_amount !== undefined || p.rate !== undefined) && !fromDoc) n.tax_amount = n.paid_amount ? d(n.paid_amount).times(d(n.rate || 0)).div(100).toDecimalPlaces(2).toFixed(2) : '';
    return n;
  });
  const pickSupplier = async (s: { id: string; code: string; name: string } | null) => {
    if (!s) return set({ supplier: null });
    const x = await api.get<Record<string, string | null>>(`/api/v1/suppliers/${s.id}`);
    set({ supplier: s, payee_name: [x.title, x.name].filter(Boolean).join(' '), payee_address: [x.address_1, x.address_2, x.address_3, x.zip_code].filter(Boolean).join(' '), payee_tax_id: x.tax_id ?? '', payee_tax_branch_no: x.tax_branch_no ?? '',
      ...(x.wht_rate && !d(x.wht_rate).isZero() ? { rate: d(x.wht_rate).toString() } : {}), ...(x.wht_form ? { form_type: /53/.test(x.wht_form) ? 'S53' as const : 'S03' as const } : {}) });
  };
  const save = async () => {
    if (ro) return;
    setErr(null);
    const body = { form_type: e.form_type, certificate_no: e.certificate_no || null, certificate_date: e.certificate_date, is_late: e.is_late, supplier_id: e.supplier?.id ?? null, payee_name: e.payee_name, payee_address: e.payee_address || null,
      payee_tax_id: e.payee_tax_id || null, payee_tax_branch_no: e.payee_tax_branch_no || null, income_type: e.income_type, condition: e.condition, paid_amount: e.paid_amount || '0', rate: e.rate || '0', tax_amount: e.tax_amount || '0' };
    try {
      if (e.id) await api.put(`/api/v1/wht/${e.id}`, body); else await api.post('/api/v1/wht', body);
      toast('บันทึกรายการภาษีหัก ณ ที่จ่ายแล้ว'); onSaved();
    } catch (x) { setErr(x); }
  };
  const cancel = async () => {
    try { await api.post(`/api/v1/wht/${e.id}/cancel`, {}); toast('ยกเลิกรายการแล้ว'); onSaved(); } catch (x) { setAskCancel(false); setErr(x); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  return (
    <Modal title={e.id ? `ภาษีหัก ณ ที่จ่าย ${e.certificate_no || ''}` : 'เพิ่มรายการภาษีหัก ณ ที่จ่าย'} size="wide" onClose={onClose}
      footer={<>
        {e.id && e.doc_status !== 'C' && <button onClick={() => nav(`/tax/wht50?entry=${e.id}`)}>🖨 พิมพ์ 50 ทวิ</button>}
        {e.header_id && e.doc_class && DOC_ROUTE[e.doc_class] && <button onClick={() => nav(`${DOC_ROUTE[e.doc_class!]}/${e.header_id}`)}>เปิดเอกสาร {e.doc_no}</button>}
        {e.id && !fromDoc && e.doc_status !== 'C' && can('cancel') && <button className="danger" onClick={() => setAskCancel(true)}>ยกเลิกรายการ</button>}
        <button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
        {!ro && <button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button>}
      </>}>
      <ErrorBox error={err} />
      {fromDoc && <p className="hint">รายการนี้มาจากเอกสาร <b className="mono">{e.doc_no}</b> — ยอดเงิน อัตรา และภาษีแก้ที่เอกสารต้นทาง ส่วนเลขที่/วันที่หนังสือรับรองและข้อมูลผู้ถูกหักแก้ที่นี่ได้</p>}
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="แบบที่ยื่น"><select value={e.form_type} disabled={ro} onChange={(x) => set({ form_type: x.target.value as Entry['form_type'] })}><option value="S53">ภ.ง.ด.53 (นิติบุคคล)</option><option value="S03">ภ.ง.ด.3 (บุคคลธรรมดา)</option></select></Field>
        <Field label="เลขที่หนังสือรับรอง" hint="เล่มที่/เลขที่"><input value={e.certificate_no} maxLength={30} disabled={ro} onChange={(x) => set({ certificate_no: x.target.value })} /></Field>
        <Field label="วันที่ออกหนังสือรับรอง" req hint="กำหนดงวดที่ยื่น"><DateInput value={e.certificate_date} disabled={ro} onChange={(v) => set({ certificate_date: v })} /></Field>
        <Field label="ยื่นเพิ่มเติม"><label className="check"><input type="checkbox" checked={e.is_late} disabled={ro} onChange={(x) => set({ is_late: x.target.checked })} /> พิมพ์แยก/ยื่นเพิ่มเติม</label></Field>
        <Field label="ผู้จำหน่าย (ดึงชื่อ ที่อยู่)" wide><SearchPick endpoint="/api/v1/suppliers" value={e.supplier} disabled={ro} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => pickSupplier(r)} /></Field>
        <Field label="ชื่อผู้ถูกหักภาษี" req wide><input value={e.payee_name} maxLength={200} disabled={ro} onChange={(x) => set({ payee_name: x.target.value })} /></Field>
        <Field label="ที่อยู่" wide><input value={e.payee_address} maxLength={500} disabled={ro} onChange={(x) => set({ payee_address: x.target.value })} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี"><input className="mono" value={e.payee_tax_id} maxLength={13} disabled={ro} onChange={(x) => set({ payee_tax_id: x.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="สาขา#"><input className="mono" value={e.payee_tax_branch_no} maxLength={5} disabled={ro} onChange={(x) => set({ payee_tax_branch_no: x.target.value })} /></Field>
        <Field label="ประเภทเงินได้" req><input list="wht-income" value={e.income_type} maxLength={60} disabled={ro} onChange={(x) => { const hit = WHT_INCOME_TYPES.find((t) => t.text === x.target.value); set({ income_type: x.target.value, ...(hit && !fromDoc ? { rate: hit.rate } : {}) }); }} />
          <datalist id="wht-income">{WHT_INCOME_TYPES.map((t) => <option key={t.text} value={t.text}>{`${t.rate}%`}</option>)}</datalist></Field>
        <Field label="เงื่อนไขการหักภาษี"><select value={e.condition} disabled={ro} onChange={(x) => set({ condition: x.target.value as Entry['condition'] })}>{Object.entries(COND_TH).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></Field>
        <Field label="จำนวนเงินที่จ่าย" req><MoneyInput value={e.paid_amount} disabled={ro || fromDoc} onChange={(v) => set({ paid_amount: v })} /></Field>
        <Field label="อัตรา %"><input className="r" inputMode="decimal" value={e.rate} disabled={ro || fromDoc} onChange={(x) => set({ rate: x.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="ภาษีที่หักไว้"><MoneyInput value={e.tax_amount} disabled={ro || fromDoc} onChange={(v) => setE((x) => ({ ...x, tax_amount: v }))} /></Field>
      </div>
      {askCancel && <Confirm danger title="ยกเลิกรายการ" text="ยกเลิกรายการภาษีหัก ณ ที่จ่ายนี้? (เปลี่ยนสถานะ ไม่ลบ)" okText="ยกเลิกรายการ" onClose={() => setAskCancel(false)} onOk={cancel} />}
    </Modal>
  );
}
