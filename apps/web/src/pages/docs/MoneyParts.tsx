/** ส่วนรับ/จ่ายเงินที่ใช้ร่วมกัน: ชำระโดยอื่น ๆ (เช็ค/โอน) และภาษีหัก ณ ที่จ่าย — ใบเสร็จ ใบสำคัญจ่าย มัดจำ รายได้/ค่าใช้จ่ายอื่น */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { d, WHT_INCOME_TYPES } from '@buddy/core';
import { api } from '../../api';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { DateInput, Money, MoneyInput } from '../../ui';

export interface Pay { key: number; payment_method_id: string; amount: string; reference_no: string; cheque_date: string; bank_id: string | null; bank_branch: string }
export interface Wht { key: number; id?: string; form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string; taxEdited: boolean; certificate_no: string; certificate_date: string }
interface Method { id: string; code: string; name_th: string; status: string; creates_cheque: boolean }
let seq = 0;
export const nextKey = () => ++seq;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
export const taxOf = (paid: string, rate: string) => (paid ? d(paid).times(d(rate || 0)).div(100).toDecimalPlaces(2).toFixed(2) : '');

/** แปลงข้อมูลจากเซิร์ฟเวอร์ → แถวบนหน้าจอ */
export const paysFrom = (rows: Array<{ payment_method_id: string; amount: string; reference_no: string | null; cheque_date: string | null; bank_id: string | null; bank_branch: string | null }>): Pay[] =>
  rows.map((p) => ({ key: nextKey(), payment_method_id: p.payment_method_id, amount: num(p.amount), reference_no: p.reference_no ?? '', cheque_date: p.cheque_date ? String(p.cheque_date).slice(0, 10) : '', bank_id: p.bank_id, bank_branch: p.bank_branch ?? '' }));
export const whtsFrom = (rows: Array<{ id: string; form_type: 'S03' | 'S53'; income_type: string; rate: string; paid_amount: string; tax_amount: string; certificate_no: string | null; certificate_date: string; doc_status: string }>): Wht[] =>
  rows.filter((w) => w.doc_status !== 'C').map((w) => ({ key: nextKey(), id: w.id, form_type: w.form_type, income_type: w.income_type, rate: num(w.rate), paid_amount: num(w.paid_amount), tax_amount: num(w.tax_amount), taxEdited: true, certificate_no: w.certificate_no ?? '', certificate_date: String(w.certificate_date).slice(0, 10) }));
/** ส่งให้เซิร์ฟเวอร์ */
export const paysBody = (pays: Pay[]) => pays.filter((p) => p.payment_method_id && !d(p.amount || 0).isZero()).map((p) => ({ payment_method_id: p.payment_method_id, amount: p.amount, reference_no: p.reference_no || null, cheque_date: p.cheque_date || null, bank_id: p.bank_id || null, bank_branch: p.bank_branch || null }));
export const whtsBody = (whts: Wht[]) => whts.map((w) => ({ form_type: w.form_type, income_type: w.income_type, rate: w.rate || '0', paid_amount: w.paid_amount || '0', tax_amount: w.tax_amount || '0', certificate_no: w.certificate_no || null, certificate_date: w.certificate_date || null }));
export const usePaymentMethods = (direction: 'R' | 'P') => useQuery({ queryKey: ['payment-methods', direction], queryFn: () => api.get<Method[]>(`/api/v1/payment-methods/${direction}`) });

/** แท็บ ชำระโดยอื่น ๆ (S-PM-01 / S-PU-C6): วิธีที่ออกเช็คต้องมีเลขที่เช็ค → เข้าทะเบียนเช็คอัตโนมัติ */
export function PaymentsTable({ pays, setPays, direction, readOnly, payDate, rest, onDirty }: {
  pays: Pay[]; setPays: (f: (p: Pay[]) => Pay[]) => void; direction: 'R' | 'P'; readOnly: boolean; payDate: string; rest: string; onDirty: () => void;
}) {
  const methods = usePaymentMethods(direction);
  const lk = useLookups('BANK');
  const mById = new Map((methods.data ?? []).map((m) => [m.id, m]));
  const set = (k: number, p: Partial<Pay>) => { setPays((ps) => ps.map((x) => (x.key === k ? { ...x, ...p } : x))); onDirty(); };
  const total = pays.reduce((s, p) => s.plus(d(p.amount || 0)), d(0));
  const rp = direction === 'R' ? 'รับ' : 'จ่าย';
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th>วิธีชำระ</th><th style={{ width: 150 }}>เลขที่เช็ค/อ้างอิง</th><th style={{ width: 130 }}>ลงวันที่</th><th style={{ width: 170 }}>ธนาคาร</th><th style={{ width: 140 }}>สาขา</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {pays.map((p) => {
            const m = mById.get(p.payment_method_id);
            return (
              <tr key={p.key}>
                <td><select value={p.payment_method_id} disabled={readOnly} onChange={(e) => set(p.key, { payment_method_id: e.target.value })} aria-label="วิธีชำระ"><option value="">— เลือก —</option>{methods.data?.filter((x) => x.status === 'A' || x.id === p.payment_method_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></td>
                <td><input value={p.reference_no} maxLength={30} disabled={readOnly} placeholder={m?.creates_cheque ? 'เลขที่เช็ค (ต้องป้อน)' : ''} onChange={(e) => set(p.key, { reference_no: e.target.value })} aria-label="เลขที่เช็ค" /></td>
                <td>{m?.creates_cheque ? <DateInput value={p.cheque_date} disabled={readOnly} onChange={(v) => set(p.key, { cheque_date: v })} /> : null}</td>
                <td>{m?.creates_cheque && direction === 'R' ? <LkSelect byId rows={lk.data?.BANK} value={p.bank_id} disabled={readOnly} onChange={(v) => set(p.key, { bank_id: v || null })} aria-label="ธนาคาร" /> : null}</td>
                <td>{m?.creates_cheque && direction === 'R' ? <input value={p.bank_branch} maxLength={60} disabled={readOnly} onChange={(e) => set(p.key, { bank_branch: e.target.value })} aria-label="สาขาธนาคาร" /> : null}</td>
                <td><MoneyInput value={p.amount} disabled={readOnly} onChange={(v) => set(p.key, { amount: v })} aria-label="จำนวนเงิน" /></td>
                <td>{!readOnly && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => { setPays((ps) => ps.filter((x) => x.key !== p.key)); onDirty(); }}>✕</button>}</td>
              </tr>
            );
          })}
          {!pays.length && <tr><td colSpan={7} className="empty">{rp}เป็นเงินสดทั้งหมด — เพิ่มวิธีชำระสำหรับเช็ค เงินโอน บัตรเครดิต</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5}>{!readOnly && <button type="button" onClick={() => { setPays((ps) => [...ps, { key: nextKey(), payment_method_id: '', amount: d(rest || 0).gt(0) ? rest : '', reference_no: '', cheque_date: payDate, bank_id: null, bank_branch: '' }]); onDirty(); }}>+ เพิ่มวิธีชำระ</button>} <span className="hint">เช็คจะเข้าทะเบียนเช็ค{rp}อัตโนมัติ · ยอดลบใช้กับค่าธรรมเนียมที่หักออก</span></td><td className="r"><b><Money v={total.toFixed(2)} /></b></td><td /></tr></tfoot>
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
