import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { computeDoc, d, dueDate, fmt } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { DocActions } from '../../components/DocPrint';

/** ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04) — บิลค้าง ณ วันเริ่มใช้ ไม่ลงบัญชี (ยอดบัญชีป้อนที่ บันทึกยอดยกมา) */
const KINDS = {
  ar: { api: 'ar-opening', menu: 'FI.AR.OB', label: 'ลูกหนี้คงค้าง-ยกมา', party: 'ลูกค้า', endpoint: '/api/v1/customers', route: '/fi/ar/opening', tone: 'sales', cls: 'IV' },
  ap: { api: 'ap-opening', menu: 'FI.AP.OB', label: 'เจ้าหนี้คงค้าง-ยกมา', party: 'ผู้จำหน่าย', endpoint: '/api/v1/suppliers', route: '/fi/ap/opening', tone: 'purchase', cls: 'RR' },
} as const;
type Kind = keyof typeof KINDS;

interface Row { id: string; doc_no: string; doc_date: string; due_date: string | null; ref_no: string | null; party_name: string; party_code: string | null; net_amount: string; vat_basis: string | null; doc_status: string; outstanding: string | null }
export function OpeningListPage({ kind }: { kind: Kind }) {
  const K = KINDS[kind];
  const nav = useNavigate();
  const can = useCan(K.menu);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: [K.api, q], queryFn: () => api.get<{ rows: Row[]; total: string; start_date: string | null }>(`/api/v1/${K.api}`, { q }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(`${K.route}/new`) : undefined }, []);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow={`การเงิน › ${kind === 'ar' ? 'ลูกหนี้' : 'เจ้าหนี้'}`} title={`บันทึกรายการ${K.label}`}
        lead={<>บิลที่ค้าง ณ วันเริ่มใช้โปรแกรม{list.data?.start_date ? <> (<DateText v={list.data.start_date} />)</> : ''} ลงวันที่ก่อนวันเริ่มใช้ · ป้อนรายใบ หรือยอดรวมของรายนั้นเป็นใบเดียว · ไม่ลงบัญชี — ยอดบัญชีป้อนที่ บันทึกยอดยกมา · รับ/จ่ายชำระได้ตามปกติ</>}
        actions={can('add') && <button className="primary" onClick={() => nav(`${K.route}/new`)}>+ เพิ่มรายการ <kbd>Ins</kbd></button>} />
      <div className="toolbar"><input type="search" autoFocus placeholder={`ค้นหาเลขที่ หรือ${K.party}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 100 }}>รหัส</th><th>{K.party}</th><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 110 }}>ครบกำหนด</th>{kind === 'ap' && <th style={{ width: 120 }}>เลขที่บิล</th>}<th className="r" style={{ width: 140 }}>จำนวนเงินรวม</th><th className="r" style={{ width: 140 }}>ค้างชำระ</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.party_code}</td><td>{r.party_name}</td><td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td><DateText v={r.due_date} /></td>{kind === 'ap' && <td className="mono">{r.ref_no}</td>}
                <td className="r"><Money v={r.net_amount} /></td><td className="r"><Money v={r.outstanding} blankZero /></td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : r.vat_basis === '2' ? <Pill tone="c">ภาษีเกณฑ์เงินสด</Pill> : <Pill tone="n">ปกติ</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={9} className="empty">ยังไม่มีรายการยกมา — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
          {!!list.data?.rows.length && <tfoot><tr><td colSpan={kind === 'ap' ? 7 : 6} className="r">ค้างชำระรวม (ไม่รวมที่ยกเลิก)</td><td className="r"><b><Money v={list.data.total} /></b></td><td /></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['คลิก/Enter', 'เปิดรายการ']]} />
    </div>
  );
}

export function OpeningFormPage({ kind }: { kind: Kind }) {
  const K = KINDS[kind];
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(K.menu);
  const cur = useQuery({ enabled: !!id, queryKey: [K.api, 'one', id], queryFn: () => api.get<Record<string, string | null> & { editable: boolean; settlements: Array<{ doc_no: string; doc_date: string; amount: string; doc_status: string }> }>(`/api/v1/${K.api}/${id}`), staleTime: 0 });
  const meta = useQuery({ enabled: !id, queryKey: [K.api, 'meta'], queryFn: () => api.get<{ start_date: string | null }>(`/api/v1/${K.api}`, { limit: 1 }) });
  type Head = { party: { id: string; code: string; name?: string | null } | null; doc_no: string; doc_date: string; ref_no: string; credit_days: string; price_type: '0' | '1' | '2'; amount: string; discount_text: string; vat_rate: string; vat_amount: string; vat_known: boolean; vat_date: string; remark: string };
  const [h, setH] = useState<Head | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (!h && !id && meta.data) {
    const before = meta.data.start_date ? new Date(new Date(meta.data.start_date).getTime() - 86400000).toISOString().slice(0, 10) : '';
    setH({ party: null, doc_no: '', doc_date: before, ref_no: '', credit_days: '', price_type: '2', amount: '', discount_text: '', vat_rate: '7', vat_amount: '', vat_known: true, vat_date: before, remark: '' });
  }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ party: { id: (c.customer_id ?? c.supplier_id)!, code: c.party_code ?? '', name: c.party_name }, doc_no: c.doc_no ?? '', doc_date: String(c.doc_date).slice(0, 10), ref_no: c.ref_no ?? '', credit_days: c.credit_days === null ? '' : String(c.credit_days),
      price_type: (c.price_type ?? '2') as Head['price_type'], amount: d(c.amount ?? 0).toString(), discount_text: c.discount_text ?? '', vat_rate: d(c.vat_rate ?? 0).toString(), vat_amount: d(c.vat_rate ?? 0).isZero() ? d(c.vat_amount ?? 0).toString() : '',
      vat_known: c.vat_basis !== '2', vat_date: c.vat_date ? String(c.vat_date).slice(0, 10) : '', remark: c.remark ?? '' });
  }
  const ro = !!id && (!cur.data?.editable || !can('edit'));
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const calc = h && computeDoc({ price_type: h.price_type, vat_rate: h.vat_rate || 0, discount_text: h.discount_text, lines: [{ qty: 1, unit_price: h.amount || 0 }] });
  const manualVat = !!h && d(h.vat_rate || 0).isZero() && h.vat_amount !== '';
  const vat = manualVat ? d(h!.vat_amount) : d(calc?.vat_amount ?? 0);
  const net = calc ? (manualVat ? d(calc.amount_after_discount).plus(h!.price_type === '1' ? 0 : vat) : d(calc.net_amount)) : d(0);
  const pickParty = async (p: { id: string; code: string; name: string } | null) => {
    if (!p) return set({ party: null });
    const x = await api.get<Record<string, string | null>>(`${K.endpoint}/${p.id}`);
    set({ party: p, credit_days: x.credit_days === null || x.credit_days === undefined ? '' : String(x.credit_days), discount_text: x.discount_text ?? '' });
  };
  const save = async (andNew = false) => {
    if (!h || busy || ro) return;
    setErr(null); setBusy(true);
    const body = { party_id: h.party?.id, doc_no: h.doc_no, doc_date: h.doc_date, ref_no: h.ref_no || null, credit_days: h.credit_days === '' ? null : Number(h.credit_days), price_type: h.price_type,
      amount: h.amount || '0', discount_text: h.discount_text || null, vat_rate: h.vat_rate || '0', vat_amount: manualVat ? h.vat_amount : null, vat_date: h.vat_known ? h.vat_date || h.doc_date : null, remark: h.remark || null };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.api}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.api}`, body);
      toast(`บันทึก ${r.doc_no} แล้ว`); setDirty(false); qc.invalidateQueries({ queryKey: [K.api] });
      if (andNew) { setH((x) => ({ ...x!, party: null, doc_no: '', ref_no: '', amount: '', vat_amount: '', remark: '' })); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) nav(`${K.route}/${r.id}`, { replace: true });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.api}/${id}/cancel`, { reason }); toast('ยกเลิกรายการแล้ว'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.api] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': id && can('cancel') && cur.data?.doc_status !== 'C' ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const cancelled = cur.data?.doc_status === 'C';
  return (
    <div className="page" data-tone={K.tone}>
      <div className="doc-title"><p className="eyebrow">การเงิน › {K.label}</p><h1>{id ? cur.data?.doc_no : 'รายการใหม่'}</h1>
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ยอดยกมา (ไม่ลงบัญชี)</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}{ro && !cancelled && id && cur.data && <Pill tone="d">ชำระแล้ว — แก้ไขไม่ได้</Pill>}</span></div>
      <div className="toolbar">
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่ <kbd>Ctrl+Enter</kbd></button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกรายการ</button>
        <DocActions kind="doc" id={id} menu={K.menu} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error} />
      {h && <div onKeyDown={navKey}>
        <div className="head-grid trade-head">
          <div className="col">
            <Field label={`รหัส${K.party}`} req><SearchPick<{ id: string; code: string; name: string }> endpoint={K.endpoint} value={h.party} disabled={ro} autoFocus={!id} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => pickParty(r)} /></Field>
            {kind === 'ap' && <Field label="เลขที่บิล" hint="ใบกำกับภาษี/เอกสารที่ผู้จำหน่ายออกให้"><input value={h.ref_no} maxLength={30} disabled={ro} onChange={(e) => set({ ref_no: e.target.value })} /></Field>}
            <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
          </div>
          <div className="col">
            <Field label="เลขที่เอกสาร" req hint={`ป้อนเอง ห้ามซ้ำเลขปีปัจจุบัน — แนะนำใส่ปีนำหน้า เช่น ${K.cls}67/0001`}><input className="mono" value={h.doc_no} maxLength={30} disabled={ro} onChange={(e) => set({ doc_no: e.target.value })} /></Field>
            <Field label="วันที่" req hint="ต้องก่อนวันเริ่มใช้โปรแกรม"><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
            <Field label="เครดิต (วัน) / ครบกำหนด"><div className="pair"><input type="number" min={0} value={h.credit_days} disabled={ro} onChange={(e) => set({ credit_days: e.target.value })} aria-label="เครดิต" /><span className="muted small" style={{ alignSelf: 'center' }}><DateText v={dueDate(h.doc_date, Number(h.credit_days || 0))} /></span></div></Field>
            <Field label="ประเภทราคา"><select value={h.price_type} disabled={ro} onChange={(e) => set({ price_type: e.target.value as Head['price_type'] })}><option value="0">0 ยกเว้นภาษี</option><option value="1">1 รวมภาษีแล้ว</option><option value="2">2 แยก VAT</option></select></Field>
          </div>
        </div>
        <div className="trade-foot">
          <div>
            <Field label={`ภาษี${kind === 'ar' ? 'ขาย' : 'ซื้อ'}เกิดขึ้นแล้วเมื่อ`} hint="สินค้าทั่วไป = วันที่บิล (เกณฑ์สิทธิ) · ค่าบริการ/ผ่อนชำระที่ยังไม่ได้รับ/จ่ายเงิน ติ๊กออก (เกณฑ์เงินสด — ภาษีเกิดเมื่อชำระ)">
              <label className="check"><input type="checkbox" checked={h.vat_known} disabled={ro} onChange={(e) => set({ vat_known: e.target.checked })} /> เกณฑ์สิทธิ</label>
              {h.vat_known && <DateInput value={h.vat_date || h.doc_date} disabled={ro} onChange={(v) => set({ vat_date: v })} />}
            </Field>
            {id && !!cur.data?.settlements.length && <><p className="hint">รายการ{kind === 'ar' ? 'รับ' : 'จ่าย'}ชำระ</p><table className="grid"><tbody>{cur.data.settlements.map((s, i) => <tr key={i} className={cx(s.doc_status === 'C' && 'cancelled')}><td className="mono">{s.doc_no}</td><td><DateText v={s.doc_date} /></td><td className="r"><Money v={s.amount} /></td></tr>)}</tbody></table></>}
          </div>
          {calc && <table className="totals-table"><tbody>
            <tr><td>จำนวนเงิน</td><td><MoneyInput value={h.amount} disabled={ro} onChange={(v) => set({ amount: v })} aria-label="จำนวนเงิน" /></td></tr>
            <tr><td>หักส่วนลด <input value={h.discount_text} maxLength={20} disabled={ro} onChange={(e) => set({ discount_text: e.target.value })} placeholder="10% หรือ 500" aria-label="ส่วนลด" style={{ width: 110 }} /></td><td className="r"><Money v={calc.discount_amount} /></td></tr>
            <tr><td>ภาษีมูลค่าเพิ่ม <input className="r" inputMode="decimal" value={h.vat_rate} disabled={ro || h.price_type === '0'} onChange={(e) => set({ vat_rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตราภาษี" style={{ width: 60 }} /> %</td>
              <td>{d(h.vat_rate || 0).isZero() && h.price_type !== '0' ? <MoneyInput value={h.vat_amount} disabled={ro} placeholder="ป้อนภาษีเอง" onChange={(v) => set({ vat_amount: v })} aria-label="จำนวนภาษี" /> : <span className="r num" style={{ display: 'block' }}>{fmt(vat.toFixed(2))}</span>}</td></tr>
            <tr className="grand"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="r"><Money v={net.toFixed(2)} /></td></tr>
            {calc.errors.length > 0 && <tr><td colSpan={2} className="bad small">{calc.errors[0]}</td></tr>}
          </tbody></table>}
        </div>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหารหัส'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิก'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกรายการ" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? (เปลี่ยนสถานะ ไม่ลบ)</>} okText="ยกเลิกรายการ" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}
