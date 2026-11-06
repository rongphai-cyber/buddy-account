import { useQuery } from '@tanstack/react-query';
import { d, depositRefundParts, depositRefundVat, type Decimal } from '@buddy/core';
import { api } from '../../api';
import { cx, DateText, Money, MoneyInput } from '../../ui';
import { DocLink } from '../../components/DocLink';

/**
 * มัดจำรับคงเหลือของลูกค้า (ใบเสร็จหักมัดจำ / ใบคืนเงินมัดจำ — 05/11/2569)
 * rd_vat = VAT ของใบคืนเงินมัดจำอื่นที่ยังใช้ · other_use = มีบิล/ใบเสร็จใช้มัดจำนี้อยู่ (ใช้คำนวณ VAT ปิดยอดแบบเดียวกับเซิร์ฟเวอร์)
 */
export interface OpenDeposit { header_id: string; doc_no: string; doc_date: string; price_type?: string; vat_rate?: string | null; amount: string; vat_amount: string | null; outstanding: string; own: string; rd_vat?: string | null; other_use?: boolean }
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
/** ใบมัดจำ → ยอดที่ใช้ */
export type DepositPicks = Record<string, string>;
export const depositTotal = (p: DepositPicks) => Object.values(p).reduce((s, v) => s.plus(d(v || 0)), d(0));
export const depositsBody = (p: DepositPicks) => Object.entries(p).filter(([, v]) => d(v || 0).gt(0)).map(([header_id, amount]) => ({ header_id, amount }));
export const depositsFrom = (rows: Array<{ header_id: string; amount: string }> | undefined) => Object.fromEntries((rows ?? []).map((x) => [x.header_id, num(x.amount)]));
const hasVat = (o: OpenDeposit) => !d(o.vat_amount ?? 0).isZero();
/** VAT ที่ใบคืนเงินที่บันทึกแล้วเก็บไว้ต่อใบมัดจำ (แสดงตามที่บันทึกจนกว่าจะแก้ยอด) */
export type SavedRefundVat = Record<string, { amount: string; vat: string | null }>;
export const savedRefundVat = (rows: Array<{ header_id: string; amount: string; vat_amount?: string | null }> | undefined): SavedRefundVat =>
  Object.fromEntries((rows ?? []).map((x) => [x.header_id, { amount: x.amount, vat: x.vat_amount ?? null }]));

/** ใบคืนเงินมัดจำ: แยกยอดคืน (หน่วยของใบมัดจำ) เป็นก่อน VAT / VAT / เงินที่จ่าย — สูตรเดียวกับเซิร์ฟเวอร์ (@buddy/core depositRefundVat) */
export function refundSplit(o: OpenDeposit, amount: string, saved?: SavedRefundVat[string]) {
  if (saved && saved.vat !== null && d(saved.amount).eq(d(amount || 0))) return { ...depositRefundParts(amount || 0, hasVat(o) ? o.price_type : '0', saved.vat), exact: false };
  return depositRefundVat({ amount: amount || 0, price_type: o.price_type, vat_rate: o.vat_rate, deposit_vat: o.vat_amount, outstanding: o.outstanding, other_rd_vat: o.rd_vat, other_use: o.other_use });
}
/** รวมของใบคืนเงิน: ก่อน VAT / VAT / เงินที่จ่าย · hasVat = เป็นใบลดหนี้ */
export function refundTotals(rows: OpenDeposit[] | undefined, picks: DepositPicks, saved: SavedRefundVat = {}) {
  let base: Decimal = d(0), vat: Decimal = d(0), paid: Decimal = d(0), vatDoc = false;
  for (const [hid, amt] of Object.entries(picks)) {
    const o = rows?.find((r) => r.header_id === hid);
    if (!o) { base = base.plus(d(amt || 0)); paid = paid.plus(d(amt || 0)); continue; }
    const p = refundSplit(o, amt, saved[hid]);
    base = base.plus(p.base); vat = vat.plus(p.vat); paid = paid.plus(p.paid);
    if (hasVat(o)) vatDoc = true;
  }
  return { base, vat, paid, hasVat: vatDoc };
}
const ptLabel = (o: OpenDeposit) => (o.price_type === '1' ? 'รวม VAT' : 'แยก VAT') + ` ${d(o.vat_rate ?? 0).toString()}%`;

/** รายการมัดจำรับคงเหลือของลูกค้า — ownId = เอกสารที่กำลังแก้ (ยอดที่ใบนี้ใช้ไว้เดิมนับกลับเป็นคงเหลือ) */
export function useOpenDeposits(partyId: string | null | undefined, ownId: string | null | undefined) {
  return useQuery({ enabled: !!partyId, queryKey: ['deposits-open', 'AR', partyId, ownId ?? null], staleTime: 0,
    queryFn: () => api.get<{ rows: OpenDeposit[] }>('/api/v1/deposits/open', { module: 'AR', party_id: partyId!, ...(ownId ? { invoice_id: ownId } : {}) }) });
}
/** จำนวนใบมัดจำที่ใบเสร็จหักได้ (ไม่มี VAT มียอดคงเหลือ) */
export const usableDeposits = (rows: OpenDeposit[] | undefined) => (rows ?? []).filter((o) => !hasVat(o) && d(o.outstanding).gt(0));

/**
 * ตารางเลือกมัดจำ: ติ๊กใบมัดจำ (ค่าเริ่มต้น = ยอดคงเหลือ หรือยอดที่เหลือต้องรับ) แก้ยอดได้ไม่เกินคงเหลือ
 * หัก (ใบเสร็จ): มัดจำที่มี VAT เลือกไม่ได้ — หักในบิลขายเท่านั้น (ภาษีถึงกำหนดแล้วตอนรับมัดจำ)
 * คืน (ใบคืนเงินมัดจำ): มัดจำที่มี VAT เลือกได้ = ใบลดหนี้ (06/11/2569) แสดงก่อน VAT / VAT / เงินที่จ่าย
 *   ใบเดียวกันต้องไม่มี VAT ทั้งหมด หรือมี VAT ประเภทราคา/อัตราเดียวกันทั้งหมด — ใบที่ไม่เข้ากับที่เลือกไว้ติ๊กไม่ได้
 */
export function DepositPickTable({ partyId, ownId, picks, setPicks, readOnly, verb, defaultOf, keep, onDirty, saved }: {
  partyId: string | null | undefined; ownId: string | null | undefined; picks: DepositPicks; setPicks: (f: (p: DepositPicks) => DepositPicks) => void; readOnly: boolean;
  verb: 'หัก' | 'คืน'; defaultOf?: (o: OpenDeposit) => string; keep?: boolean; onDirty: () => void; saved?: SavedRefundVat;
}) {
  const open = useOpenDeposits(partyId, ownId);
  if (!partyId) return <p className="empty">เลือกลูกค้าก่อน แล้วเลือกใบมัดจำที่จะ{verb}</p>;
  const rows = open.data?.rows ?? [];
  const total = depositTotal(picks);
  const refund = verb === 'คืน';
  // คืน: ใบแรกที่เลือกกำหนดชนิด (มี/ไม่มี VAT ประเภทราคา อัตรา)
  const firstPick = rows.find((o) => picks[o.header_id] !== undefined);
  const clash = (o: OpenDeposit) => !!firstPick && firstPick.header_id !== o.header_id && picks[o.header_id] === undefined
    && (hasVat(o) !== hasVat(firstPick) || (hasVat(o) && (o.price_type !== firstPick.price_type || d(o.vat_rate ?? 0).toString() !== d(firstPick.vat_rate ?? 0).toString())));
  const showVat = refund && rows.some(hasVat);
  const sum = refund ? refundTotals(rows, picks, saved) : null;
  const cols = showVat ? 9 : 6;
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th style={{ width: 36 }} /><th style={{ width: 140 }}>ใบมัดจำ</th><th style={{ width: 110 }}>วันที่</th><th className="r" style={{ width: 130 }}>ยอดมัดจำ</th><th className="r" style={{ width: 130 }} title={ownId ? 'ยอดที่ใช้ได้ในใบนี้ = คงเหลือรวมยอดที่ใบนี้ใช้ไว้' : undefined}>{ownId ? 'คงเหลือก่อนใบนี้' : 'คงเหลือ'}</th><th className="r" style={{ width: 150 }}>{verb}ในใบนี้</th>
          {showVat && <><th className="r" style={{ width: 120 }}>ก่อน VAT</th><th className="r" style={{ width: 100 }}>VAT</th><th className="r" style={{ width: 130 }}>เงินที่จ่าย</th></>}</tr></thead>
        <tbody>
          {rows.map((o) => {
            const on = picks[o.header_id] !== undefined;
            const vat = hasVat(o);
            // หัก: มัดจำมี VAT เลือกไม่ได้ · คืน: เลือกได้ เว้นแต่ไม่เข้ากับใบที่เลือกไว้แล้ว
            const blocked = refund ? clash(o) : vat;
            const over = on && d(picks[o.header_id] || 0).gt(d(o.outstanding));
            const split = on && showVat ? refundSplit(o, picks[o.header_id] ?? '', saved?.[o.header_id]) : null;
            const why = !refund && vat ? 'มัดจำที่มีภาษีมูลค่าเพิ่ม — หักในบิลขาย (ขายเงินเชื่อ/ขายเงินสด) เท่านั้น'
              : blocked ? `${vat ? `มัดจำมี VAT (${ptLabel(o)})` : 'มัดจำไม่มี VAT'} ไม่เข้ากับ ${firstPick?.doc_no} ที่เลือกไว้ — แยกเป็นใบคืนเงินมัดจำคนละใบ`
                : refund && vat ? `มัดจำมี VAT (${ptLabel(o)}) — คืนแล้วออกเป็นใบลดหนี้ ลดภาษีขาย` : undefined;
            return (
              <tr key={o.header_id} className={cx(on && 'picked', !blocked && !readOnly && 'row-open')} title={why}
                onClick={(e) => { if (readOnly || blocked || (e.target as HTMLElement).closest('input,a')) return; setPicks((m) => { const n = { ...m }; if (on) delete n[o.header_id]; else n[o.header_id] = defaultOf ? defaultOf(o) : num(o.outstanding); return n; }); onDirty(); }}>
                <td className="c"><input type="checkbox" checked={on} disabled={readOnly || (blocked && !on)} onChange={(e) => { setPicks((m) => { const n = { ...m }; if (e.target.checked) n[o.header_id] = defaultOf ? defaultOf(o) : num(o.outstanding); else delete n[o.header_id]; return n; }); onDirty(); }} aria-label={`${verb}มัดจำ ${o.doc_no}`} /></td>
                <td><DocLink id={o.header_id} no={o.doc_no} cls="AI" keep={keep} />{vat && <span className={cx('small', refund ? 'muted' : 'bad')}> {refund ? `มี VAT ${ptLabel(o)} — ใบลดหนี้` : 'มี VAT — หักในบิลขาย'}</span>}
                  {blocked && refund && <span className="bad small"> แยกเป็นใบคืนเงินมัดจำคนละใบ</span>}</td>
                <td><DateText v={o.doc_date} /></td><td className="r"><Money v={o.amount} /></td><td className="r"><Money v={o.outstanding} /></td>
                <td>{on && <MoneyInput value={picks[o.header_id]} disabled={readOnly} onChange={(v) => { setPicks((m) => ({ ...m, [o.header_id]: v })); onDirty(); }} aria-label={`ยอด${verb}มัดจำ ${o.doc_no}`} />}
                  {over && <div className="bad small">เกินคงเหลือ <Money v={o.outstanding} /></div>}</td>
                {showVat && <><td className="r">{split && <Money v={split.base.toFixed(2)} />}</td><td className="r">{split && <Money v={split.vat.toFixed(2)} />}{split?.exact && <div className="muted small" title="คืนครบ: VAT = ภาษีของใบมัดจำ − ภาษีที่คืนไปแล้ว (ปิดยอดตรงสตางค์)">ปิดยอดภาษี</div>}</td>
                  <td className="r">{split && <Money v={split.paid.toFixed(2)} />}</td></>}
              </tr>
            );
          })}
          {open.data && !rows.length && <tr><td colSpan={cols} className="empty">ไม่มีเงินมัดจำคงเหลือของลูกค้ารายนี้</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5} className="r">{verb}เงินมัดจำรวม</td><td className="r"><b><Money v={total.toFixed(2)} /></b></td>
          {showVat && sum && <><td className="r"><b><Money v={sum.base.toFixed(2)} /></b></td><td className="r"><b><Money v={sum.vat.toFixed(2)} /></b></td><td className="r"><b><Money v={sum.paid.toFixed(2)} /></b></td></>}</tr></tfoot>
      </table>
    </div>
  );
}
