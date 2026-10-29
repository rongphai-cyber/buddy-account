import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BANK_KINDS, CASH_KINDS, d, SETTLE_KINDS, todayIso, TRADE_KINDS, type BankKind } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { DocActions } from '../../components/DocPrint';
import { DocJournalTab } from './TradeDocs';
import { DocTypeTabs, initialType, NO_TYPE_MSG, TypeNotice, useTypeTabs } from '../../components/DocTypeTabs';
import { bookStyle, typeColorIn } from '../../bookColor';

/** การเคลื่อนไหวบัญชีเงินฝาก (คู่มือบทที่ 13 S-BK-02/03 + รายได้/ค่าใช้จ่ายธนาคาร) — ลงบัญชีทันทีเมื่อบันทึก */
const MENU = 'FI.BK.TX';
const kindOf = (cls: string) => BANK_KINDS.find((k) => k.cls === cls)!;
const LEAD: Record<BankKind['cls'], string> = {
  BD: 'นำเงินสดฝากเข้าบัญชีเงินฝาก — Dr เงินฝาก / Cr เงินสด (บัญชีตามประเภทเอกสาร)',
  BW: 'ถอนเงินสดจากบัญชีเงินฝาก — Dr เงินสด / Cr เงินฝาก',
  BT: 'โอนเงินระหว่างบัญชีเงินฝาก 2 บัญชี (ค่าธรรมเนียมหักจากบัญชีต้นทาง) — Dr ปลายทาง + Dr ค่าธรรมเนียม / Cr ต้นทาง',
  BU: 'ดอกเบี้ยรับ/รายได้ที่ธนาคารนำเข้าบัญชี (ธนาคารหักภาษี ณ ที่จ่ายได้) — Dr เงินฝาก + Dr ภาษีถูกหัก / Cr รายได้ธนาคาร',
  BV: 'ค่าธรรมเนียม/ดอกเบี้ยจ่ายที่ธนาคารหักจากบัญชี — Dr ค่าใช้จ่ายธนาคาร / Cr เงินฝาก',
};
interface BankAcc { id: string; code: string; name: string; status: string; gl_account_id: string | null; account_number: string | null }
const useBanks = () => useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<BankAcc[]>('/api/v1/bank-accounts') });
function BankSelect({ value, onChange, disabled, label, exclude }: { value: string; onChange: (v: string) => void; disabled?: boolean; label: string; exclude?: string }) {
  const banks = useBanks();
  return <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label}><option value="">—</option>
    {banks.data?.filter((b) => (b.status === 'A' || b.id === value) && b.id !== exclude).map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}{b.account_number ? ` (${b.account_number})` : ''}</option>)}</select>;
}

interface Row { id: string; doc_no: string; doc_date: string; remark: string | null; amount: string; wht_amount: string; net_amount: string; doc_status: string; bank_code: string; bank_name: string; to_bank_code: string | null; voucher_no: string | null }
export function BankDocListPage({ cls }: { cls: BankKind['cls'] }) {
  const K = kindOf(cls);
  const nav = useNavigate();
  const can = useCan(MENU);
  const [q, setQ] = useState('');
  const [bank, setBank] = useState('');
  const tt = useTypeTabs(cls);
  const list = useQuery({ queryKey: [K.path, q, bank, tt.tab], queryFn: () => api.get<{ rows: Row[] }>(`/api/v1/${K.path}`, { type_id: tt.tab || undefined, q, ...(bank ? { bank_account_id: bank } : {}) }), placeholderData: (p) => p });
  useHotkeys({ Insert: can('add') ? () => nav(tt.newUrl(`${K.route}/new`)) : undefined }, [tt.tab, K.route]);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร" title={K.label} lead={LEAD[cls]} actions={can('add') && <button className={cx('primary', tt.color && 'book-btn')} style={bookStyle(tt.color)} onClick={() => nav(tt.newUrl(`${K.route}/new`))}>+ เพิ่มรายการ {tt.cur ? `${tt.cur.code} ` : ''}<kbd>Ins</kbd></button>} />
      <Tabs active={cls} onChange={(c) => nav(kindOf(c).route)} tabs={BANK_KINDS.map((k) => ({ key: k.cls, label: k.label.replace(/ \(.*\)$/, '') }))} />
      {tt.tabs()}
      <div className="toolbar">
        <input type="search" autoFocus placeholder="ค้นหาเลขที่ หรือหมายเหตุ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <label>บัญชีเงินฝาก <BankSelect value={bank} onChange={setBank} label="บัญชีเงินฝาก" /></label>
        <button onClick={() => nav('/fi/bank/book')}>สมุดเงินฝาก</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 140 }}>เลขที่</th><th style={{ width: 110 }}>วันที่</th><th style={{ width: 220 }}>{cls === 'BT' ? 'โอนจาก → เข้า' : 'บัญชีเงินฝาก'}</th><th>หมายเหตุ</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th style={{ width: 130 }}>ใบสำคัญ</th><th style={{ width: 90 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className={cx('row-open', r.doc_status === 'C' && 'cancelled')} tabIndex={0} onClick={() => nav(`${K.route}/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`${K.route}/${r.id}`)}>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td><td>{r.bank_code} {cls === 'BT' ? `→ ${r.to_bank_code}` : r.bank_name}</td><td>{r.remark}</td>
                <td className="r"><Money v={r.amount} /></td><td className="mono">{r.voucher_no}</td><td>{r.doc_status === 'C' ? <Pill tone="x">ยกเลิก</Pill> : <Pill tone="n">ลงบัญชีแล้ว</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีรายการ — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['คลิก/Enter', 'เปิดรายการ']]} />
    </div>
  );
}

type Head = { doc_type_id: string; doc_date: string; department_id: string; remark: string; bank_account_id: string; to_bank_account_id: string; amount: string; fee: string; wht: string };
export function BankDocFormPage({ cls }: { cls: BankKind['cls'] }) {
  const K = kindOf(cls);
  const { id: routeId } = useParams();
  const id = routeId && routeId !== 'new' ? routeId : null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan(MENU);
  const { me } = useSession();
  const defs = useQuery({ queryKey: ['trade-defaults', cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string; department_id: string | null }> }>(`/api/v1/trade-defaults/${cls}`) });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Array<{ id: string; code: string; name_th: string; status: string }>>('/api/v1/departments') });
  const cur = useQuery({ enabled: !!id, queryKey: [K.path, 'one', id], staleTime: 0, queryFn: () => api.get<Record<string, string | null> & { editable: boolean }>(`/api/v1/${K.path}/${id}`) });
  const [h, setH] = useState<Head | null>(null);
  const [tab, setTab] = useState('main');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState('');
  if (!h && !id && defs.data) {
    const t = initialType(defs.data.types);
    setH({ doc_type_id: t?.id ?? '', doc_date: me?.work_date ?? todayIso(), department_id: t?.department_id ?? '', remark: '', bank_account_id: '', to_bank_account_id: '', amount: '', fee: '', wht: '' });
  }
  if (!h && id && cur.data) {
    const c = cur.data;
    setH({ doc_type_id: c.doc_type_id!, doc_date: String(c.doc_date).slice(0, 10), department_id: c.department_id ?? '', remark: c.remark ?? '', bank_account_id: c.bank_account_id ?? '', to_bank_account_id: c.to_bank_account_id ?? '',
      amount: d(c.amount ?? 0).toFixed(2), fee: d(c.fee ?? 0).isZero() ? '' : d(c.fee!).toFixed(2), wht: d(c.wht_amount ?? 0).isZero() ? '' : d(c.wht_amount!).toFixed(2) });
  }
  const ro = !!id && (!cur.data?.editable || !can('edit'));
  const cancelled = cur.data?.doc_status === 'C';
  const set = (p: Partial<Head>) => { setH((x) => ({ ...x!, ...p })); setDirty(true); };
  const total = h ? (cls === 'BT' ? d(h.amount || 0).plus(d(h.fee || 0)) : cls === 'BU' ? d(h.amount || 0).minus(d(h.wht || 0)) : d(h.amount || 0)) : d(0);
  /** เลือกประเภทจากแถบ (ใบใหม่) — ค่าเริ่มต้นตามประเภทนั้น */
  const pickType = (v: string) => { const t = defs.data?.types.find((x) => x.id === v); set({ doc_type_id: v, ...(t?.department_id ? { department_id: t.department_id } : {}) }); };
  const tColor = typeColorIn(defs.data?.types, h?.doc_type_id);
  const tCur = defs.data?.types.find((x) => x.id === h?.doc_type_id);
  const save = async (andNew = false) => {
    if (h && !h.doc_type_id) { setErr(new Error(NO_TYPE_MSG)); return; }
    if (!h || busy || ro) return;
    setErr(null); setBusy(true);
    const body = { doc_type_id: h.doc_type_id, doc_date: h.doc_date, department_id: h.department_id || null, remark: h.remark || null, bank_account_id: h.bank_account_id || undefined,
      to_bank_account_id: cls === 'BT' ? h.to_bank_account_id || null : null, amount: h.amount || '0', fee: cls === 'BT' ? h.fee || '0' : undefined, wht: cls === 'BU' ? h.wht || '0' : undefined };
    try {
      const r = id ? await api.put<{ id: string; doc_no: string }>(`/api/v1/${K.path}/${id}`, body) : await api.post<{ id: string; doc_no: string }>(`/api/v1/${K.path}`, body);
      toast(`บันทึก ${r.doc_no} แล้ว`); setDirty(false); await qc.invalidateQueries({ queryKey: [K.path] }); qc.invalidateQueries({ queryKey: ['doc-journal'] }); qc.invalidateQueries({ queryKey: ['bank-book'] });
      if (andNew) { setH(null); nav(`${K.route}/new`, { replace: true }); }
      else if (!id) { setH(null); nav(`${K.route}/${r.id}`, { replace: true }); }
      else { await qc.refetchQueries({ queryKey: [K.path, 'one', id] }); setH(null); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancelDoc = async () => {
    try { await api.post(`/api/v1/${K.path}/${id}/cancel`, { reason }); toast('ยกเลิกรายการแล้ว (ใบสำคัญยกเลิกด้วย)'); setAskCancel(false); qc.invalidateQueries({ queryKey: [K.path] }); nav(K.route); }
    catch (e) { setAskCancel(false); setErr(e); }
  };
  useHotkeys({ F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': id && can('cancel') && !cancelled ? () => setAskCancel(true) : undefined,
    Escape: () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav(K.route); } }, []);
  const bankLabel = cls === 'BT' ? 'โอนจากบัญชี' : cls === 'BD' || cls === 'BU' ? 'เข้าบัญชีเงินฝาก' : 'จากบัญชีเงินฝาก';
  return (
    <div className={cx('page', tColor && 'book-colored')} data-tone="finance" style={bookStyle(tColor)}>
      <div className="doc-title"><p className="eyebrow">ธนาคาร › {K.label}</p><h1>{id ? cur.data?.doc_no : 'รายการใหม่'}</h1>{tCur && <span className="book-pill" title="ประเภทเอกสาร">{!id ? 'กำลังบันทึก: ' : ''}{tCur.code} {tCur.name_th}</span>}
        <span className="doc-state">{cancelled ? <Pill tone="x">ยกเลิก</Pill> : id ? <Pill tone="n">ลงบัญชีแล้ว</Pill> : <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill>}{dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}</span></div>
      <div className="toolbar">
        <button className="primary" disabled={busy || ro} onClick={() => save()}>บันทึก <kbd>F9</kbd></button>
        <button disabled={busy || ro} onClick={() => save(true)}>บันทึก+ใหม่ <kbd>Ctrl+Enter</kbd></button>
        <button disabled={!id || cancelled || !can('cancel')} onClick={() => setAskCancel(true)}>ยกเลิกรายการ <kbd>Alt+C</kbd></button>
        <DocActions kind="doc" id={id} menu={MENU} />
        <button onClick={() => nav(K.route)}>รายการ <kbd>Esc</kbd></button>
      </div>
      <DocTypeTabs types={defs.data?.types} value={h?.doc_type_id ?? ''} locked={!!id} onChange={pickType} />
      <TypeNotice show={!id && !!h && !h.doc_type_id} />
      <ErrorBox error={err ?? cur.error ?? defs.error} />
      {h && <>
        {id && <Tabs active={tab} onChange={setTab} tabs={[{ key: 'main', label: 'รายละเอียด' }, { key: 'gl', label: 'ใบสำคัญที่ลงบัญชี' }]} />}
        {tab === 'gl' && id ? <DocJournalTab id={id} /> : <div onKeyDown={navKey}>
          <div className="head-grid trade-head">
            <div className="col">
              <Field label={bankLabel} req><BankSelect value={h.bank_account_id} disabled={ro} label={bankLabel} onChange={(v) => set({ bank_account_id: v })} /></Field>
              {cls === 'BT' && <Field label="โอนเข้าบัญชี" req><BankSelect value={h.to_bank_account_id} disabled={ro} label="โอนเข้าบัญชี" exclude={h.bank_account_id} onChange={(v) => set({ to_bank_account_id: v })} /></Field>}
              <Field label={cls === 'BT' ? 'จำนวนเงินที่โอน' : cls === 'BU' ? 'ดอกเบี้ย/รายได้ (ก่อนหักภาษี)' : 'จำนวนเงิน'} req><MoneyInput value={h.amount} disabled={ro} onChange={(v) => set({ amount: v })} aria-label="จำนวนเงิน" /></Field>
              {cls === 'BT' && <Field label="ค่าธรรมเนียม" hint="ถ้าธนาคารหักค่าธรรมเนียมจากบัญชีต้นทาง"><MoneyInput value={h.fee} disabled={ro} onChange={(v) => set({ fee: v })} aria-label="ค่าธรรมเนียม" /></Field>}
              {cls === 'BU' && <Field label="ภาษีที่ธนาคารหัก ณ ที่จ่าย"><MoneyInput value={h.wht} disabled={ro} onChange={(v) => set({ wht: v })} aria-label="ภาษีหัก ณ ที่จ่าย" /></Field>}
              {(cls === 'BT' || cls === 'BU') && <Field label={cls === 'BT' ? 'รวมเงินที่โอนออกทั้งสิ้น' : 'เงินเข้าบัญชีสุทธิ'}><span className="num" style={{ display: 'block', textAlign: 'right' }}><b><Money v={total.toFixed(2)} /></b></span></Field>}
            </div>
            <div className="col">
              
              <Field label="วันที่" req><DateInput value={h.doc_date} disabled={ro} onChange={(v) => set({ doc_date: v })} /></Field>
              <Field label="แผนก"><select value={h.department_id} disabled={ro} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((x) => x.status === 'A' || x.id === h.department_id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></Field>
              <Field label="หมายเหตุ"><input value={h.remark} maxLength={200} disabled={ro} onChange={(e) => set({ remark: e.target.value })} /></Field>
            </div>
          </div>
          {defs.data && !defs.data.types.length && <p className="bad">ยังไม่มีประเภทเอกสารของ{K.label} — เพิ่มที่ เริ่มระบบ › เลขที่เอกสาร</p>}
        </div>}
      </>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Alt+C', 'ยกเลิก'], ['Esc', 'กลับรายการ']]} />
      {askCancel && <Confirm danger title="ยกเลิกรายการ" text={<>ยกเลิก <b>{cur.data?.doc_no}</b>? ใบสำคัญจะถูกยกเลิกด้วย (เปลี่ยนสถานะ ไม่ลบ)</>} okText="ยกเลิกรายการ" onClose={() => setAskCancel(false)} onOk={cancelDoc}>
        <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>}
    </div>
  );
}

/** สมุดเงินฝาก — รายการเคลื่อนไหวและยอดคงเหลือของบัญชีเงินฝาก (จากใบสำคัญ ตรงกับงบทดลอง) */
const DOC_ROUTE: Record<string, string> = Object.fromEntries([...TRADE_KINDS, ...SETTLE_KINDS, ...CASH_KINDS, ...BANK_KINDS].map((k) => [k.cls, k.route]));
export function BankBookPage() {
  const nav = useNavigate();
  const { me } = useSession();
  const banks = useBanks();
  const today = me?.work_date ?? todayIso();
  const [bank, setBank] = useState('');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const cur = bank || banks.data?.find((b) => b.status === 'A' && b.gl_account_id)?.id || '';
  const book = useQuery({ enabled: !!cur, queryKey: ['bank-book', cur, from, to], queryFn: () => api.get<{ bank: { code: string; name: string; account_number: string | null }; account: { account_no: string; name_th: string }; opening: string; closing: string; debit: string; credit: string;
    rows: Array<{ journal_id: string; voucher_no: string; voucher_date: string; journal_description: string | null; description: string | null; debit: string; credit: string; balance: string; source_doc_no: string | null; source_header_id: string | null; source_doc_class: string | null; reference: string | null }> }>('/api/v1/bank-book', { bank_account_id: cur, from, to }) });
  const b = book.data;
  const open = (r: NonNullable<typeof b>['rows'][number]) => { const to2 = r.source_doc_class ? DOC_ROUTE[r.source_doc_class] : null; nav(r.source_header_id && to2 ? `${to2}/${r.source_header_id}` : `/gl/journals/${r.journal_id}`); };
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร" title="สมุดเงินฝาก" lead="ความเคลื่อนไหวของบัญชีเงินฝาก คำนวณสดจากใบสำคัญของเลขที่บัญชีที่ผูกไว้ (ตรงกับงบทดลองเสมอ) · คลิกรายการเพื่อเปิดเอกสาร" />
      <div className="toolbar">
        <label>บัญชีเงินฝาก <BankSelect value={cur} onChange={setBank} label="บัญชีเงินฝาก" /></label>
        <label>ตั้งแต่ <DateInput value={from} onChange={setFrom} /></label>
        <label>ถึง <DateInput value={to} onChange={setTo} /></label>
        {b && <span className="muted small">เลขที่บัญชี {b.account.account_no} {b.account.name_th}{b.bank.account_number ? ` · สมุดบัญชี ${b.bank.account_number}` : ''}</span>}
      </div>
      <ErrorBox error={book.error ?? banks.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 100 }}>วันที่</th><th style={{ width: 130 }}>ใบสำคัญ</th><th style={{ width: 130 }}>เอกสาร</th><th>รายการ</th><th className="r" style={{ width: 130 }}>ฝาก/เข้า</th><th className="r" style={{ width: 130 }}>ถอน/ออก</th><th className="r" style={{ width: 150 }}>คงเหลือ</th></tr></thead>
          <tbody>
            {b && <tr className="muted"><td colSpan={6}>ยอดยกมา</td><td className="r"><Money v={b.opening} /></td></tr>}
            {b?.rows.map((r, i) => (
              <tr key={i} className="row-open" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => e.key === 'Enter' && open(r)}>
                <td><DateText v={r.voucher_date} /></td><td className="mono">{r.voucher_no}</td><td className="mono">{r.source_doc_no ?? r.reference}</td><td>{r.description || r.journal_description}</td>
                <td className="r"><Money v={r.debit} blankZero /></td><td className="r"><Money v={r.credit} blankZero /></td><td className={cx('r', d(r.balance).lt(0) && 'bad')}><Money v={r.balance} /></td>
              </tr>
            ))}
            {b && !b.rows.length && <tr><td colSpan={7} className="empty">ไม่มีความเคลื่อนไหวในช่วงนี้</td></tr>}
          </tbody>
          {b && <tfoot><tr><td colSpan={4} className="r">รวม</td><td className="r"><b><Money v={b.debit} /></b></td><td className="r"><b><Money v={b.credit} /></b></td><td className="r"><b><Money v={b.closing} /></b></td></tr></tfoot>}
        </table>
      </div>
      <KeyHints keys={[['คลิก/Enter', 'เปิดเอกสาร/ใบสำคัญ']]} />
    </div>
  );
}
