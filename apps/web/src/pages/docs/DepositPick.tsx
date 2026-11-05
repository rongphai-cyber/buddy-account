import { useQuery } from '@tanstack/react-query';
import { d } from '@buddy/core';
import { api } from '../../api';
import { cx, DateText, Money, MoneyInput } from '../../ui';
import { DocLink } from '../../components/DocLink';

/** มัดจำรับคงเหลือของลูกค้า (ใบเสร็จหักมัดจำ / ใบคืนเงินมัดจำ — 05/11/2569) */
export interface OpenDeposit { header_id: string; doc_no: string; doc_date: string; amount: string; vat_amount: string | null; outstanding: string; own: string }
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : d(v as string).toString());
/** ใบมัดจำ → ยอดที่ใช้ */
export type DepositPicks = Record<string, string>;
export const depositTotal = (p: DepositPicks) => Object.values(p).reduce((s, v) => s.plus(d(v || 0)), d(0));
export const depositsBody = (p: DepositPicks) => Object.entries(p).filter(([, v]) => d(v || 0).gt(0)).map(([header_id, amount]) => ({ header_id, amount }));
export const depositsFrom = (rows: Array<{ header_id: string; amount: string }> | undefined) => Object.fromEntries((rows ?? []).map((x) => [x.header_id, num(x.amount)]));
const hasVat = (o: OpenDeposit) => !d(o.vat_amount ?? 0).isZero();

/** รายการมัดจำรับคงเหลือของลูกค้า — ownId = เอกสารที่กำลังแก้ (ยอดที่ใบนี้ใช้ไว้เดิมนับกลับเป็นคงเหลือ) */
export function useOpenDeposits(partyId: string | null | undefined, ownId: string | null | undefined) {
  return useQuery({ enabled: !!partyId, queryKey: ['deposits-open', 'AR', partyId, ownId ?? null], staleTime: 0,
    queryFn: () => api.get<{ rows: OpenDeposit[] }>('/api/v1/deposits/open', { module: 'AR', party_id: partyId!, ...(ownId ? { invoice_id: ownId } : {}) }) });
}
/** จำนวนใบมัดจำที่ใช้ได้ (ไม่มี VAT มียอดคงเหลือ) */
export const usableDeposits = (rows: OpenDeposit[] | undefined) => (rows ?? []).filter((o) => !hasVat(o) && d(o.outstanding).gt(0));

/**
 * ตารางเลือกมัดจำ: ติ๊กใบมัดจำ (ค่าเริ่มต้น = ยอดคงเหลือ หรือยอดที่เหลือต้องรับ) แก้ยอดได้ไม่เกินคงเหลือ
 * มัดจำที่มี VAT เลือกไม่ได้ — หักในบิลขายเท่านั้น (ภาษีถึงกำหนดแล้วตอนรับมัดจำ)
 */
export function DepositPickTable({ partyId, ownId, picks, setPicks, readOnly, verb, defaultOf, keep, onDirty }: {
  partyId: string | null | undefined; ownId: string | null | undefined; picks: DepositPicks; setPicks: (f: (p: DepositPicks) => DepositPicks) => void; readOnly: boolean;
  verb: 'หัก' | 'คืน'; defaultOf?: (o: OpenDeposit) => string; keep?: boolean; onDirty: () => void;
}) {
  const open = useOpenDeposits(partyId, ownId);
  if (!partyId) return <p className="empty">เลือกลูกค้าก่อน แล้วเลือกใบมัดจำที่จะ{verb}</p>;
  const rows = open.data?.rows ?? [];
  const total = depositTotal(picks);
  return (
    <div className="table-wrap lines">
      <table className="grid">
        <thead><tr><th style={{ width: 36 }} /><th style={{ width: 140 }}>ใบมัดจำ</th><th style={{ width: 110 }}>วันที่</th><th className="r" style={{ width: 130 }}>ยอดมัดจำ</th><th className="r" style={{ width: 130 }} title={ownId ? 'ยอดที่ใช้ได้ในใบนี้ = คงเหลือรวมยอดที่ใบนี้ใช้ไว้' : undefined}>{ownId ? 'คงเหลือก่อนใบนี้' : 'คงเหลือ'}</th><th className="r" style={{ width: 150 }}>{verb}ในใบนี้</th></tr></thead>
        <tbody>
          {rows.map((o) => {
            const on = picks[o.header_id] !== undefined;
            const vat = hasVat(o);
            const over = on && d(picks[o.header_id] || 0).gt(d(o.outstanding));
            return (
              <tr key={o.header_id} className={cx(on && 'picked', !vat && !readOnly && 'row-open')} title={vat ? `มัดจำที่มีภาษีมูลค่าเพิ่ม — ${verb === 'หัก' ? 'หักในบิลขาย (ขายเงินเชื่อ/ขายเงินสด) เท่านั้น' : 'คืนในหน้านี้ไม่ได้ (ต้องลดภาษีขายด้วยใบลดหนี้)'}` : undefined}
                onClick={(e) => { if (readOnly || vat || (e.target as HTMLElement).closest('input,a')) return; setPicks((m) => { const n = { ...m }; if (on) delete n[o.header_id]; else n[o.header_id] = defaultOf ? defaultOf(o) : num(o.outstanding); return n; }); onDirty(); }}>
                <td className="c"><input type="checkbox" checked={on} disabled={readOnly || (vat && !on)} onChange={(e) => { setPicks((m) => { const n = { ...m }; if (e.target.checked) n[o.header_id] = defaultOf ? defaultOf(o) : num(o.outstanding); else delete n[o.header_id]; return n; }); onDirty(); }} aria-label={`${verb}มัดจำ ${o.doc_no}`} /></td>
                <td><DocLink id={o.header_id} no={o.doc_no} cls="AI" keep={keep} />{vat && <span className="bad small"> มี VAT — {verb === 'หัก' ? 'หักในบิลขาย' : 'คืนที่นี่ไม่ได้'}</span>}</td>
                <td><DateText v={o.doc_date} /></td><td className="r"><Money v={o.amount} /></td><td className="r"><Money v={o.outstanding} /></td>
                <td>{on && <MoneyInput value={picks[o.header_id]} disabled={readOnly} onChange={(v) => { setPicks((m) => ({ ...m, [o.header_id]: v })); onDirty(); }} aria-label={`ยอด${verb}มัดจำ ${o.doc_no}`} />}
                  {over && <div className="bad small">เกินคงเหลือ <Money v={o.outstanding} /></div>}</td>
              </tr>
            );
          })}
          {open.data && !rows.length && <tr><td colSpan={6} className="empty">ไม่มีเงินมัดจำคงเหลือของลูกค้ารายนี้</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5} className="r">{verb}เงินมัดจำรวม</td><td className="r"><b><Money v={total.toFixed(2)} /></b></td></tr></tfoot>
      </table>
    </div>
  );
}
