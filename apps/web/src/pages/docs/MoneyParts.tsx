/** ส่วนรับ/จ่ายเงินที่ใช้ร่วมกัน: ชำระโดยอื่น ๆ (เช็ค/โอน) และภาษีหัก ณ ที่จ่าย — ใบเสร็จ ใบสำคัญจ่าย มัดจำ รายได้/ค่าใช้จ่ายอื่น */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { d, fmt, WHT_INCOME_TYPES, wht50FormOf } from '@buddy/core';
import { api } from '../../api';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { DateInput, Field, Money, MoneyInput } from '../../ui';

/** cheque_amount: หน้าเช็คเมื่อมากกว่ายอดที่ใช้ (เหลือในเช็ค) · cheque_id: ใช้ยอดคงเหลือของเช็คเดิม */
export interface Pay { key: number; payment_method_id: string; amount: string; reference_no: string; cheque_date: string; bank_id: string | null; bank_branch: string; cheque_amount?: string; cheque_id?: string | null; cheque_label?: string }
export interface Wht { key: number; id?: string; form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string; taxEdited: boolean; certificate_no: string; certificate_date: string }
interface Method { id: string; code: string; name_th: string; status: string; creates_cheque: boolean }
let seq = 0;
export const nextKey = () => ++seq;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
export const taxOf = (paid: string, rate: string) => (paid ? d(paid).times(d(rate || 0)).div(100).toDecimalPlaces(2).toFixed(2) : '');

/** แปลงข้อมูลจากเซิร์ฟเวอร์ → แถวบนหน้าจอ */
export const paysFrom = (rows: Array<{ payment_method_id: string; amount: string; reference_no: string | null; cheque_date: string | null; bank_id: string | null; bank_branch: string | null; cheque_id?: string | null; cheque_face?: string | null; own_cheque?: boolean | null; cheque_no?: string | null }>): Pay[] =>
  rows.map((p) => ({ key: nextKey(), payment_method_id: p.payment_method_id, amount: num(p.amount), reference_no: p.reference_no ?? '', cheque_date: p.cheque_date ? String(p.cheque_date).slice(0, 10) : '', bank_id: p.bank_id, bank_branch: p.bank_branch ?? '',
    cheque_amount: p.own_cheque && p.cheque_face && d(p.cheque_face).gt(d(p.amount)) ? num(p.cheque_face) : '', cheque_id: p.cheque_id && p.own_cheque === false ? p.cheque_id : null, cheque_label: p.own_cheque === false ? p.cheque_no ?? '' : undefined }));
export const whtsFrom = (rows: Array<{ id: string; form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string; certificate_no: string | null; certificate_date: string; doc_status: string }>): Wht[] =>
  rows.filter((w) => w.doc_status !== 'C').map((w) => ({ key: nextKey(), id: w.id, form_type: w.form_type, income_type: w.income_type, rate: num(w.rate), paid_amount: num(w.paid_amount), tax_amount: num(w.tax_amount), taxEdited: true, certificate_no: w.certificate_no ?? '', certificate_date: String(w.certificate_date).slice(0, 10) }));
/** ส่งให้เซิร์ฟเวอร์ */
export const paysBody = (pays: Pay[]) => pays.filter((p) => p.payment_method_id && !d(p.amount || 0).isZero()).map((p) => ({ payment_method_id: p.payment_method_id, amount: p.amount, reference_no: p.cheque_id ? null : p.reference_no || null, cheque_date: p.cheque_date || null, bank_id: p.bank_id || null, bank_branch: p.bank_branch || null,
  cheque_amount: p.cheque_amount || null, cheque_id: p.cheque_id || null }));
export const whtsBody = (whts: Wht[]) => whts.map((w) => ({ form_type: w.form_type, income_type: w.income_type, rate: w.rate || '0', paid_amount: w.paid_amount || '0', tax_amount: w.tax_amount || '0', certificate_no: w.certificate_no || null, certificate_date: w.certificate_date || null }));
export const usePaymentMethods = (direction: 'R' | 'P') => useQuery({ queryKey: ['payment-methods', direction], queryFn: () => api.get<Method[]>(`/api/v1/payment-methods/${direction}`) });

/** แท็บ ชำระโดยอื่น ๆ (S-PM-01 / S-PU-C6): วิธีที่ออกเช็คต้องมีเลขที่เช็ค → เข้าทะเบียนเช็คอัตโนมัติ */
export function PaymentsTable({ pays, setPays, direction, readOnly, payDate, rest, onDirty, partyId }: {
  pays: Pay[]; setPays: (f: (p: Pay[]) => Pay[]) => void; direction: 'R' | 'P'; readOnly: boolean; payDate: string; rest: string; onDirty: () => void; partyId?: string | null;
}) {
  // เช็คเดิมของคู่ค้าที่ยังมียอดคงเหลือ (S-BK-04) — นำมาลดหนี้ครั้งนี้ได้
  const left = useQuery({ enabled: direction === 'R' && !!partyId && !readOnly, queryKey: ['cheques', 'remaining', partyId], queryFn: () => api.get<{ rows: Array<{ id: string; cheque_no: string; cheque_date: string; remaining_amount: string; written_off_amount: string; method_id: string | null }> }>('/api/v1/cheques', { direction: 'R', remaining: 'Y', party_id: partyId!, instrument: 'all' }) });
  const avail = (left.data?.rows ?? []).filter((c) => !pays.some((p) => p.cheque_id === c.id));
  const methods = usePaymentMethods(direction);
  const lk = useLookups('BANK');
  const mById = new Map((methods.data ?? []).map((m) => [m.id, m]));
  const set = (k: number, p: Partial<Pay>) => { setPays((ps) => ps.map((x) => (x.key === k ? { ...x, ...p } : x))); onDirty(); };
  const total = pays.reduce((s, p) => s.plus(d(p.amount || 0)), d(0));
  const rp = direction === 'R' ? 'รับ' : 'จ่าย';
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th>วิธีชำระ</th><th style={{ width: 150 }}>เลขที่เช็ค/อ้างอิง</th><th style={{ width: 130 }}>ลงวันที่</th><th style={{ width: 170 }}>ธนาคาร</th><th style={{ width: 140 }}>สาขา</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th>{direction === 'R' && <th className="r" style={{ width: 130 }} title="เช็คมากกว่าหนี้ — ส่วนเกินเป็นยอดคงเหลือในเช็ค">หน้าเช็ค (ถ้ามากกว่า)</th>}<th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {pays.map((p) => {
            const m = mById.get(p.payment_method_id);
            return (
              <tr key={p.key}>
                <td><select value={p.payment_method_id} disabled={readOnly} onChange={(e) => set(p.key, { payment_method_id: e.target.value })} aria-label="วิธีชำระ"><option value="">— เลือก —</option>{methods.data?.filter((x) => x.status === 'A' || x.id === p.payment_method_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></td>
                <td>{p.cheque_id ? <span className="mono" title="ใช้ยอดคงเหลือในเช็คเดิม">↺ {p.cheque_label}</span> : <input value={p.reference_no} maxLength={30} disabled={readOnly} placeholder={m?.creates_cheque ? 'เลขที่เช็ค (ต้องป้อน)' : ''} onChange={(e) => set(p.key, { reference_no: e.target.value })} aria-label="เลขที่เช็ค" />}</td>
                <td>{m?.creates_cheque ? <DateInput value={p.cheque_date} disabled={readOnly} onChange={(v) => set(p.key, { cheque_date: v })} /> : null}</td>
                <td>{m?.creates_cheque && direction === 'R' ? <LkSelect byId rows={lk.data?.BANK} value={p.bank_id} disabled={readOnly} onChange={(v) => set(p.key, { bank_id: v || null })} aria-label="ธนาคาร" /> : null}</td>
                <td>{m?.creates_cheque && direction === 'R' ? <input value={p.bank_branch} maxLength={60} disabled={readOnly} onChange={(e) => set(p.key, { bank_branch: e.target.value })} aria-label="สาขาธนาคาร" /> : null}</td>
                <td><MoneyInput value={p.amount} disabled={readOnly} onChange={(v) => set(p.key, { amount: v })} aria-label="จำนวนเงิน" /></td>
                {direction === 'R' && <td>{m?.creates_cheque && !p.cheque_id ? <MoneyInput value={p.cheque_amount ?? ''} disabled={readOnly} placeholder="เท่ายอดชำระ" onChange={(v) => set(p.key, { cheque_amount: v })} aria-label="จำนวนเงินหน้าเช็ค" /> : null}</td>}
                <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setPays((ps) => ps.filter((x) => x.key !== p.key)); onDirty(); }}>✕</button>}</td>
              </tr>
            );
          })}
          {!pays.length && <tr><td colSpan={8} className="empty">{rp}เป็นเงินสดทั้งหมด — เพิ่มวิธีชำระสำหรับเช็ค เงินโอน บัตรเครดิต</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5}>{!readOnly && <button type="button" onClick={() => { setPays((ps) => [...ps, { key: nextKey(), payment_method_id: '', amount: d(rest || 0).gt(0) ? rest : '', reference_no: '', cheque_date: payDate, bank_id: null, bank_branch: '' }]); onDirty(); }}>+ เพิ่มวิธีชำระ</button>} {!readOnly && avail.length > 0 && <select value="" aria-label="ใช้ยอดคงเหลือในเช็ค" onChange={(e) => { const c = avail.find((x) => x.id === e.target.value); if (!c) return; const lft = d(c.remaining_amount).minus(d(c.written_off_amount)); setPays((ps) => [...ps, { key: nextKey(), payment_method_id: c.method_id ?? '', amount: (d(rest || 0).gt(0) && d(rest).lt(lft) ? d(rest) : lft).toFixed(2), reference_no: '', cheque_date: String(c.cheque_date).slice(0, 10), bank_id: null, bank_branch: '', cheque_id: c.id, cheque_label: c.cheque_no }]); onDirty(); }}>
          <option value="">↺ ใช้ยอดคงเหลือในเช็คเดิม ({avail.length})</option>{avail.map((c) => <option key={c.id} value={c.id}>{c.cheque_no} เหลือ {d(c.remaining_amount).minus(d(c.written_off_amount)).toFixed(2)}</option>)}</select>} <span className="hint">เช็คจะเข้าทะเบียนเช็ค{rp}อัตโนมัติ · ยอดลบใช้กับค่าธรรมเนียมที่หักออก</span></td><td className="r"><b><Money v={total.toFixed(2)} /></b></td>{direction === 'R' && <td />}<td /></tr></tfoot>
      </table>
    </div>
  );
}

/** แท็บ ภาษีหัก ณ ที่จ่าย (S-PU-C4/C5): ได้ 2 ประเภทเงินได้ · บันทึกแล้วพิมพ์ 50 ทวิ ได้ */
export function WhtTable({ whts, setWhts, readOnly, base, defaults, canAdd, dirty, onDirty }: {
  whts: Wht[]; setWhts: (f: (w: Wht[]) => Wht[]) => void; readOnly: boolean; base: string; defaults: { form: 'S03' | 'S53'; rate: string }; canAdd: boolean; dirty: boolean; onDirty: () => void;
}) {
  const nav = useNavigate();
  const set = (k: number, p: Partial<Wht>) => { setWhts((ws) => ws.map((w) => { if (w.key !== k) return w; const n = { ...w, ...p }; if ((p.paid_amount !== undefined || p.rate !== undefined) && !n.taxEdited) n.tax_amount = taxOf(n.paid_amount, n.rate); return n; })); onDirty(); };
  const total = whts.reduce((s, w) => s.plus(d(w.tax_amount || 0)), d(0));
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th style={{ width: 120 }}>แบบ</th><th>ประเภทเงินได้</th><th className="r" style={{ width: 80 }}>อัตรา %</th><th className="r" style={{ width: 140 }}>จำนวนเงินที่จ่าย</th><th className="r" style={{ width: 120 }}>ภาษีที่หักไว้</th><th style={{ width: 130 }}>เลขที่หนังสือรับรอง</th><th style={{ width: 130 }}>วันที่ออก</th><th style={{ width: 90 }} /></tr></thead>
        <tbody>
          {whts.map((w) => (
            <tr key={w.key}>
              <td><select value={w.form_type} disabled={readOnly} onChange={(e) => set(w.key, { form_type: e.target.value as Wht['form_type'] })} aria-label="แบบ ภ.ง.ด."><option value="S03">ภ.ง.ด.3</option><option value="S53">ภ.ง.ด.53</option></select></td>
              <td><input list="wht-income-types" value={w.income_type} maxLength={60} disabled={readOnly} onChange={(e) => { const hit = WHT_INCOME_TYPES.find((x) => x.text === e.target.value); set(w.key, { income_type: e.target.value, ...(hit ? { rate: hit.rate } : {}) }); }} aria-label="ประเภทเงินได้" /></td>
              <td><input className="r" inputMode="decimal" value={w.rate} disabled={readOnly} onChange={(e) => set(w.key, { rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตรา" /></td>
              <td><MoneyInput value={w.paid_amount} disabled={readOnly} onChange={(v) => set(w.key, { paid_amount: v })} aria-label="จำนวนเงินที่จ่าย" /></td>
              <td><MoneyInput value={w.tax_amount} disabled={readOnly} onChange={(v) => set(w.key, { tax_amount: v, taxEdited: true })} aria-label="ภาษีที่หัก" /></td>
              <td><input value={w.certificate_no} maxLength={30} disabled={readOnly} placeholder="= เลขที่เอกสาร" onChange={(e) => set(w.key, { certificate_no: e.target.value })} aria-label="เลขที่หนังสือรับรอง" /></td>
              <td><DateInput value={w.certificate_date} disabled={readOnly} onChange={(v) => set(w.key, { certificate_date: v })} /></td>
              <td>{w.id && !dirty ? <button type="button" onClick={() => nav(`/tax/wht50?entry=${w.id}`)}>🖨 50 ทวิ</button> : !readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setWhts((ws) => ws.filter((x) => x.key !== w.key)); onDirty(); }}>✕</button>}</td>
            </tr>
          ))}
          {!whts.length && <tr><td colSpan={8} className="empty">ไม่มีการหักภาษี ณ ที่จ่าย</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={4}>{!readOnly && whts.length < 2 && <button type="button" disabled={!canAdd} onClick={() => { setWhts((ws) => [...ws, { key: nextKey(), form_type: defaults.form, income_type: 'ค่าบริการ', rate: defaults.rate, paid_amount: base, tax_amount: taxOf(base, defaults.rate), taxEdited: false, certificate_no: '', certificate_date: '' }]); onDirty(); }}>+ หักภาษี ณ ที่จ่าย</button>} <span className="hint">ได้ 2 ประเภทเงินได้ · ยอดเข้าแฟ้ม ภ.ง.ด.3/53 · พิมพ์ 50 ทวิ ได้หลังบันทึก</span></td><td className="r"><b><Money v={total.toFixed(2)} /></b></td><td colSpan={3} /></tr></tfoot>
      </table>
      <datalist id="wht-income-types">{WHT_INCOME_TYPES.map((x) => <option key={x.text} value={x.text}>{`${x.rate}%`}</option>)}</datalist>
    </div>
  );
}

/* ---------------------------------------------------------------- หักโดยแพลตฟอร์ม (ใบเสร็จ — ข้อกำหนดเจ้าของ 31/10/2569) */
/** ผู้ให้บริการ เลขที่/วันที่ใบกำกับ แบบภาษีหัก ณ ที่จ่าย เงื่อนไข — ใช้ร่วมทุกบรรทัดของใบเสร็จ */
export interface ChargeHead { supplier: { id: string; code: string; name?: string | null } | null; tax_invoice_no: string; tax_invoice_date: string; wht_form: '' | 'S03' | 'S53'; wht_condition: '1' | '3' }
export interface ChargeLine { key: number; item: { id: string; code: string; name?: string | null } | null; description: string; amount: string; vat_type: '0' | '1' | '3'; vat_amount: string; vatEdited: boolean;
  wht_income_type: string; wht_rate: string; wht_amount: string; whtEdited: boolean }
export type ChargeRow = { supplier_id: string; supplier_code: string; supplier_name: string; item_id: string; item_code: string; item_name: string; description: string | null; amount: string; vat_type: string; vat_amount: string;
  tax_invoice_no: string | null; tax_invoice_date: string | null; wht_form: string | null; wht_income_type: string | null; wht_rate: string; wht_amount: string; wht_condition: string };
export const emptyChargeHead = (): ChargeHead => ({ supplier: null, tax_invoice_no: '', tax_invoice_date: '', wht_form: '', wht_condition: '1' });
const VAT_RATE = '7';
/** ยอดที่ถูกหักจากเงินโอน: ค่าบริการ + VAT ในประเทศ (ภ.พ.36 เรานำส่งเอง ไม่ได้ถูกหัก) */
export const chargeTotal = (ls: ChargeLine[]) => ls.reduce((s, l) => s.plus(d(l.amount || 0)).plus(l.vat_type === '1' ? d(l.vat_amount || 0) : d(0)), d(0)).toFixed(2);
/** keepAmounts = false: แม่แบบจากใบเสร็จครั้งก่อน (ผู้ให้บริการ รหัส VAT ภาษีหัก ณ ที่จ่าย ไม่เอายอดเงินและเลขที่ใบกำกับ) */
export const chargesFrom = (rows: ChargeRow[], keepAmounts = true): { head: ChargeHead; lines: ChargeLine[] } => {
  const f = rows[0];
  return {
    head: f ? { supplier: { id: f.supplier_id, code: f.supplier_code, name: f.supplier_name }, tax_invoice_no: keepAmounts ? f.tax_invoice_no ?? '' : '', tax_invoice_date: keepAmounts && f.tax_invoice_date ? String(f.tax_invoice_date).slice(0, 10) : '',
      wht_form: (f.wht_form ?? '') as ChargeHead['wht_form'], wht_condition: f.wht_condition === '3' ? '3' : '1' } : emptyChargeHead(),
    lines: rows.map((c) => ({ key: nextKey(), item: { id: c.item_id, code: c.item_code, name: c.item_name }, description: c.description ?? '', amount: keepAmounts ? num(c.amount) : '', vat_type: (c.vat_type as ChargeLine['vat_type']) ?? '1',
      vat_amount: keepAmounts ? num(c.vat_amount) : '', vatEdited: keepAmounts, wht_income_type: c.wht_income_type ?? 'ค่าบริการ', wht_rate: num(c.wht_rate) || '3', wht_amount: keepAmounts ? num(c.wht_amount) : '', whtEdited: keepAmounts })),
  };
};
export const chargesBody = (h: ChargeHead, ls: ChargeLine[]) => ls.filter((l) => l.item || !d(l.amount || 0).isZero()).map((l) => ({
  supplier_id: h.supplier?.id ?? null, item_id: l.item?.id ?? null, description: l.description || null, amount: l.amount || '0', vat_type: l.vat_type, vat_amount: l.vat_type === '0' ? '0' : l.vat_amount || '0',
  tax_invoice_no: h.tax_invoice_no || null, tax_invoice_date: h.tax_invoice_date || null, wht_form: h.wht_form || null, wht_income_type: h.wht_form ? l.wht_income_type || null : null,
  wht_rate: h.wht_form ? l.wht_rate || '0' : '0', wht_amount: h.wht_form ? l.wht_amount || '0' : '0', wht_condition: h.wht_condition }));
const newCharge = (vat: ChargeLine['vat_type']): ChargeLine => ({ key: nextKey(), item: null, description: '', amount: '', vat_type: vat, vat_amount: '', vatEdited: false, wht_income_type: 'ค่าบริการ', wht_rate: '3', wht_amount: '', whtEdited: false });

/**
 * แท็บ หักโดยแพลตฟอร์ม: ค่า GP/คอมมิชชั่น ค่าธรรมเนียม ค่าโฆษณาที่ Grab LINE MAN Agoda Booking.com Airbnb ฯลฯ หักก่อนโอน
 * VAT 1 = ภาษีซื้อ (ใบกำกับภาษีในประเทศ) · 3 = ภ.พ.36 (ผู้ให้บริการต่างประเทศ เรานำส่งแทน) · 0 = ไม่มี VAT · ภาษีหัก ณ ที่จ่ายที่เราหักเข้าแฟ้ม ภ.ง.ด.3/53
 */
export function ChargesTable({ head, setHead, lines, setLines, readOnly, onDirty }: {
  head: ChargeHead; setHead: (h: ChargeHead) => void; lines: ChargeLine[]; setLines: (f: (l: ChargeLine[]) => ChargeLine[]) => void; readOnly: boolean; onDirty: () => void;
}) {
  const calc = (n: ChargeLine) => ({ ...n, vat_amount: n.vat_type === '0' ? '' : n.vatEdited ? n.vat_amount : taxOf(n.amount, VAT_RATE), wht_amount: n.whtEdited ? n.wht_amount : taxOf(n.amount, n.wht_rate) });
  const set = (k: number, p: Partial<ChargeLine>) => { setLines((ls) => ls.map((l) => (l.key === k ? calc({ ...l, ...p }) : l))); onDirty(); };
  const hd = (p: Partial<ChargeHead>) => { setHead({ ...head, ...p }); onDirty(); };
  const wht = !!head.wht_form;
  const sum = (f: (l: ChargeLine) => string) => lines.reduce((s, l) => s.plus(d(f(l) || 0)), d(0)).toFixed(2);
  const pickSupplier = async (s: { id: string; code: string; name: string } | null) => {
    if (!s) return hd({ supplier: null });
    // ไม่มีเลขผู้เสียภาษีไทย = ผู้ให้บริการต่างประเทศ → ภ.พ.36 ไม่หัก ณ ที่จ่าย · มีเลข → ภาษีซื้อ หัก ณ ที่จ่ายตามแบบของผู้จำหน่าย
    const x = await api.get<{ tax_id: string | null; wht_form: string | null }>(`/api/v1/suppliers/${s.id}`);
    const foreign = !x.tax_id;
    setHead({ ...head, supplier: s, wht_form: foreign ? '' : wht50FormOf(x.wht_form, x.tax_id) === '3' ? 'S03' : 'S53' });
    setLines((ls) => (ls.length ? ls : [newCharge(foreign ? '3' : '1')]).map((l) => (l.amount ? l : calc({ ...l, vat_type: foreign ? '3' : '1' }))));
    onDirty();
  };
  return (
    <div>
      <div className="head-grid trade-head">
        <div className="col">
          <Field label="ผู้ให้บริการ (แพลตฟอร์ม)" req={lines.length > 0} hint="ผู้จำหน่ายที่หักค่าบริการ เช่น Grab LINE MAN Agoda Booking.com Airbnb — ต่างประเทศไม่มีเลขผู้เสียภาษีไทย">
            <SearchPick<{ id: string; code: string; name: string; tax_id?: string | null }> endpoint="/api/v1/suppliers" value={head.supplier} required={lines.length > 0} disabled={readOnly}
              label={(r: { name: string }) => r.name} describe={(r: { tax_id?: string | null }) => r.tax_id ?? 'ต่างประเทศ'} onPick={(r: { id: string; code: string; name: string } | null) => void pickSupplier(r)} aria-label="ผู้ให้บริการ" /></Field>
          <Field label="ภาษีหัก ณ ที่จ่ายที่เราหัก" hint="นิติบุคคลจ่ายค่าบริการให้บริษัทในประเทศต้องหัก (ค่าบริการ/นายหน้า 3% โฆษณา 2%) — ผู้ให้บริการต่างประเทศไม่ต้องเลือก">
            <select value={head.wht_form} disabled={readOnly} onChange={(e) => hd({ wht_form: e.target.value as ChargeHead['wht_form'] })} aria-label="แบบภาษีหัก ณ ที่จ่าย">
              <option value="">ไม่หัก</option><option value="S53">หัก — ภ.ง.ด.53 (นิติบุคคล)</option><option value="S03">หัก — ภ.ง.ด.3 (บุคคลธรรมดา)</option></select></Field>
          {wht && <Field label="ผู้ออกภาษี" hint="แพลตฟอร์มหักค่าบริการเต็มจำนวนแล้ว: 1 = ตั้งเป็นภาษีรอเรียกคืนจากแพลตฟอร์ม · 3 = เราออกภาษีให้ (เป็นค่าใช้จ่าย)">
            <select value={head.wht_condition} disabled={readOnly} onChange={(e) => hd({ wht_condition: e.target.value as ChargeHead['wht_condition'] })} aria-label="เงื่อนไขภาษีหัก ณ ที่จ่าย">
              <option value="1">1 หัก ณ ที่จ่าย (เรียกคืนจากแพลตฟอร์ม)</option><option value="3">3 ออกภาษีให้ครั้งเดียว</option></select></Field>}
        </div>
        <div className="col">
          <Field label="เลขที่ใบกำกับภาษี/ใบแจ้งหนี้" req={lines.some((l) => l.vat_type === '1')} hint="ภาษีซื้อ (VAT 1) ต้องมีใบกำกับภาษีจากแพลตฟอร์ม"><input value={head.tax_invoice_no} maxLength={30} disabled={readOnly} onChange={(e) => hd({ tax_invoice_no: e.target.value })} /></Field>
          <Field label="วันที่ใบกำกับภาษี" hint="ว่าง = วันที่รับเงิน"><DateInput value={head.tax_invoice_date} disabled={readOnly} onChange={(v) => hd({ tax_invoice_date: v })} /></Field>
        </div>
      </div>
      <div className="table-wrap lines">
        <table className="grid">
          <thead><tr><th style={{ width: 150 }}>รหัสค่าใช้จ่าย</th><th>รายละเอียด</th><th className="r" style={{ width: 130 }}>ค่าบริการ (ก่อน VAT)</th><th style={{ width: 150 }}>VAT</th><th className="r" style={{ width: 110 }}>ภาษีมูลค่าเพิ่ม</th>
            {wht && <><th style={{ width: 140 }}>ประเภทเงินได้</th><th className="r" style={{ width: 70 }}>อัตรา %</th><th className="r" style={{ width: 110 }}>ภาษีที่เราหัก</th></>}<th className="r" style={{ width: 130 }}>ยอดที่ถูกหัก</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td><SearchPick endpoint="/api/v1/item-search" params={{ module: 'AP', types: '5,2' }} value={l.item} required={!!l.amount} disabled={readOnly} label={(r: { name_th: string }) => r.name_th}
                  onPick={(r: { id: string; code: string; name_th: string } | null) => set(l.key, r ? { item: { id: r.id, code: r.code, name: r.name_th }, description: l.description || r.name_th } : { item: null })} aria-label="รหัสค่าใช้จ่าย" /></td>
                <td><input value={l.description} maxLength={200} disabled={readOnly} placeholder="เช่น ค่า GP 30% · ค่าคอมมิชชั่น · ค่าโฆษณา" onChange={(e) => set(l.key, { description: e.target.value })} aria-label="รายละเอียดรายการหัก" /></td>
                <td><MoneyInput value={l.amount} disabled={readOnly} onChange={(v) => set(l.key, { amount: v })} aria-label="ค่าบริการ" /></td>
                <td><select value={l.vat_type} disabled={readOnly} onChange={(e) => set(l.key, { vat_type: e.target.value as ChargeLine['vat_type'], vatEdited: false })} aria-label="ประเภท VAT"
                  title="1 = มีใบกำกับภาษีในประเทศ (ภาษีซื้อ) · 3 = ผู้ให้บริการต่างประเทศ เรายื่น ภ.พ.36 นำส่งแทน (เป็นภาษีซื้อเดือนถัดไป) · 0 = ไม่มี VAT หรือ VAT ที่ขอคืนไม่ได้ (รวมในค่าบริการ)">
                  <option value="1">1 · ภาษีซื้อ 7%</option><option value="3">3 · ภ.พ.36 (ต่างประเทศ)</option><option value="0">0 · ไม่มี VAT</option></select></td>
                <td>{l.vat_type !== '0' && <MoneyInput value={l.vat_amount} disabled={readOnly} onChange={(v) => set(l.key, { vat_amount: v, vatEdited: true })} aria-label="ภาษีมูลค่าเพิ่ม" />}</td>
                {wht && <>
                  <td><input list="wht-income-types" value={l.wht_income_type} maxLength={60} disabled={readOnly} onChange={(e) => { const hit = WHT_INCOME_TYPES.find((x) => x.text === e.target.value); set(l.key, { wht_income_type: e.target.value, ...(hit ? { wht_rate: hit.rate, whtEdited: false } : {}) }); }} aria-label="ประเภทเงินได้" /></td>
                  <td><input className="r" inputMode="decimal" value={l.wht_rate} disabled={readOnly} onChange={(e) => set(l.key, { wht_rate: e.target.value.replace(/[^\d.]/g, ''), whtEdited: false })} aria-label="อัตราภาษีหัก ณ ที่จ่าย" /></td>
                  <td><MoneyInput value={l.wht_amount} disabled={readOnly} onChange={(v) => set(l.key, { wht_amount: v, whtEdited: true })} aria-label="ภาษีที่เราหัก" /></td>
                </>}
                <td className="r num">{fmt(d(l.amount || 0).plus(l.vat_type === '1' ? d(l.vat_amount || 0) : d(0)).toFixed(2))}</td>
                <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); onDirty(); }}>✕</button>}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={10} className="empty">ไม่มีรายการหัก — ใช้เมื่อขายผ่านแพลตฟอร์มออนไลน์ แล้วแพลตฟอร์มหักค่า GP/คอมมิชชั่น/ค่าธรรมเนียม/ค่าโฆษณาก่อนโอนเงิน</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={2}>{!readOnly && <button type="button" onClick={() => { setLines((ls) => [...ls, newCharge(ls.at(-1)?.vat_type ?? '1')]); onDirty(); }}>+ เพิ่มรายการหัก</button>}</td>
            <td className="r"><Money v={sum((l) => l.amount)} /></td><td /><td className="r"><Money v={sum((l) => (l.vat_type === '0' ? '' : l.vat_amount))} blankZero /></td>
            {wht && <><td colSpan={2} /><td className="r"><Money v={sum((l) => l.wht_amount)} blankZero /></td></>}<td className="r"><b><Money v={chargeTotal(lines)} /></b></td><td /></tr></tfoot>
        </table>
        <p className="hint">ยอดที่ถูกหัก = ค่าบริการ + VAT ที่แพลตฟอร์มเรียกเก็บ (ภ.พ.36 ไม่รวม เพราะเรานำส่งเอง) · ลงบัญชี: ค่าใช้จ่ายตามรหัส · ภาษีซื้อ / ภาษีซื้อรอเครดิต ภ.พ.36 · ภาษีหัก ณ ที่จ่ายค้างจ่าย — ดูรายงาน แบบ ภ.พ.36 ที่ รายงานภาษี 6.7</p>
      </div>
      <datalist id="wht-income-types">{WHT_INCOME_TYPES.map((x) => <option key={x.text} value={x.text}>{`${x.rate}%`}</option>)}</datalist>
    </div>
  );
}
