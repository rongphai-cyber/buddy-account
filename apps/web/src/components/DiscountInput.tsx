import { useRef, useState } from 'react';
import { d, discountAmount, DISCOUNT_HINT, fmt, normalizeDiscount } from '@buddy/core';
import { groupNum, toast } from '../ui';

/**
 * ช่องส่วนลด (ข้อกำหนดเจ้าของ 30/10/2569): ตรวจรูปแบบทันทีที่ Enter/ออกจากช่อง — ผิดแล้วไม่ให้ Enter ผ่าน เตือนติดช่อง
 * 200 = บาท · 5% หรือ 5+ = เปอร์เซ็นต์ · 5+2+ = ซ้อน · 5+,200 = 5% แล้วลดอีก 200 บาท
 */
export function DiscountInput({ value, onChange, base, label, ...rest }: {
  value: string; onChange: (v: string) => void; base: string | number | null | undefined; label: string;
  disabled?: boolean; placeholder?: string; style?: React.CSSProperties; className?: string;
}) {
  const [bad, setBad] = useState(false);
  const [focus, setFocus] = useState(false);
  // ออกจากช่อง: ส่วนลดเป็นจำนวนเงินอย่างเดียว แสดงคั่นหลักพัน (5,000.00) · ขณะคีย์แสดงตามที่พิมพ์
  const shown = !focus && /^\d+(\.\d+)?$/.test(value.trim()) ? groupNum(value.trim(), 2) : value;
  const problem = () => {
    if (!value.trim()) return null;
    const amt = discountAmount(value, base ?? 0);
    if (amt === null) return `${label} "${value}" ไม่ถูกรูปแบบ — ${DISCOUNT_HINT}`;
    if (base != null && d(base).gt(0) && amt.gt(d(base))) return `${label}มากกว่าจำนวนเงิน — แก้ส่วนลดใหม่`;
    return null;
  };
  return (
    <input {...rest} value={shown} maxLength={20} aria-label={label} aria-invalid={bad || undefined} placeholder={rest.placeholder ?? '5+ · 200 · 5+,200'}
      title={DISCOUNT_HINT}
      onFocus={() => setFocus(true)}
      onChange={(e) => { setBad(false); onChange(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const p = problem();
        if (p) { e.preventDefault(); e.stopPropagation(); setBad(true); toast(p, 'bad', e.currentTarget); }
      }}
      onBlur={(e) => {
        setFocus(false);
        const n = normalizeDiscount(value);
        if (n !== value.replace(/\s+/g, '') && /^\d+(\.\d+)?$/.test(n)) onChange(n);   // 5,000 → 5000 (คั่นหลักพัน)
        const p = problem(); setBad(!!p); if (p) toast(p, 'bad', e.currentTarget);
      }} />
  );
}

/**
 * ช่องจำนวนเงินของบรรทัด (ข้อกำหนดเจ้าของ): คีย์ยอดเงินที่ต้องการได้เลย —
 * มีราคาต่อหน่วย: ส่วนลด (บาท) = จำนวน × ราคา − ยอดที่คีย์ · ยังไม่มีราคา: ราคาต่อหน่วย = ยอดที่คีย์ ÷ จำนวน
 */
export function LineAmountInput({ amount, qty, price, disabled, onApply }: {
  amount: string | null | undefined; qty: string; price: string; disabled?: boolean;
  onApply: (p: { discount_text?: string; unit_price?: string }) => void;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const done = useRef(false);   // Enter แล้วโฟกัสย้าย (blur) ในจังหวะเดียวกัน — คิดครั้งเดียว
  const commit = (el: HTMLElement) => {
    if (txt === null || done.current) return true;
    done.current = true;
    const raw = txt.replace(/,/g, '').trim();
    setTxt(null);
    if (raw === '' || (amount != null && d(amount).eq(d(raw || 0)))) return true;
    const fail = (m: string) => { done.current = false; setTxt(txt); toast(m, 'bad', el); return false; };
    if (!/^\d+(\.\d+)?$/.test(raw)) return fail('จำนวนเงินต้องเป็นตัวเลข เช่น 275 หรือ 1250.50');
    const amt = d(raw), q = d(qty || 0), p = d(price || 0);
    if (q.lte(0)) return fail('ป้อนจำนวนก่อน แล้วจึงคีย์จำนวนเงิน');
    if (p.isZero()) { onApply({ unit_price: amt.div(q).toDecimalPlaces(4).toString(), discount_text: '' }); toast(`คิดราคาต่อหน่วยให้ ${fmt(amt.div(q).toDecimalPlaces(4), { places: 4 })} (จำนวนเงิน ÷ จำนวน)`, 'ok', el); return true; }
    const gross = q.times(p).toDecimalPlaces(2);
    if (amt.gt(gross)) return fail(`จำนวนเงิน ${fmt(amt)} มากกว่า จำนวน × ราคา (${fmt(gross)}) — แก้ราคาต่อหน่วยแทน`);
    const disc = gross.minus(amt);
    onApply({ discount_text: disc.isZero() ? '' : disc.toFixed(2) });
    toast(disc.isZero() ? 'ไม่มีส่วนลด (จำนวนเงินเท่ากับ จำนวน × ราคา)' : `คิดส่วนลดให้ ${fmt(disc)} บาท (จำนวน × ราคา ${fmt(gross)} − ${fmt(amt)})`, 'ok', el);
    return true;
  };
  return (
    <input className="r" inputMode="decimal" aria-label="จำนวนเงิน" disabled={disabled} title="คีย์จำนวนเงินที่ต้องการ — โปรแกรมคิดส่วนลด (หรือราคาต่อหน่วย) ให้"
      value={txt ?? (amount ? fmt(amount) : '')}
      onFocus={(e) => { done.current = false; setTxt(amount ? d(amount).toFixed(2) : ''); const el = e.currentTarget; setTimeout(() => el.select(), 0); }}
      onChange={(e) => setTxt(e.target.value.replace(/[^\d.,]/g, ''))}
      onKeyDown={(e) => { if (e.key === 'Enter' && !commit(e.currentTarget)) { e.preventDefault(); e.stopPropagation(); } }}
      onBlur={(e) => { commit(e.currentTarget); }} />
  );
}
