import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { Confirm, DateInput, ErrorBox, Field, KeyHints, Modal, MoneyInput, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';

/* ---------------------------------------------------------------- บัญชีเงินฝาก S-CQ-01 / S-BK-01 */
interface BankAccount { id: string; code: string; name: string; branch: string | null; account_number: string | null; short_name: string | null; account_kind: string | null; bank_id: string | null; bank_code: string | null; bank_name: string | null; gl_account_id: string | null; account_no: string | null; account_name: string | null; currency: string; opening_balance: string | null; opening_date: string | null; status: string; cheque_count: number; method_count: number }
const KIND: Record<string, string> = { C: 'กระแสรายวัน', S: 'ออมทรัพย์', F: 'ฝากประจำ/ต่างประเทศ', H: 'เงินสด (บัญชีหลอก)' };

export function BankAccountsPage() {
  const can = useCan('FI.BK.ACC');
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useSession();
  const list = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<BankAccount[]>('/api/v1/bank-accounts') });
  const [edit, setEdit] = useState<BankAccount | 'new' | null>(null);
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="ธนาคาร › รายละเอียดบัญชีเงินฝาก" title="รายละเอียดบัญชีเงินฝาก"
        lead="บัญชีเงินฝากของกิจการ ใช้กับรายการฝาก-ถอน รับ-จ่ายเช็ค โอนเงินระหว่างบัญชี และโอนชำระหนี้ — เลขที่บัญชีในผังบัญชีคือบัญชีที่ลงสมุดรายวันเมื่อมีรายการผ่านบัญชีนี้ · รับเงินสดแทนเช็คคืนใช้บัญชีเงินฝากหลอกที่ผูกกับบัญชีเงินสด"
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มบัญชีเงินฝาก <kbd>Ins</kbd></button>} />
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 70 }}>รหัส</th><th>ชื่อบัญชีเงินฝาก</th><th style={{ width: 110 }}>ประเภท</th><th style={{ width: 90 }}>ธนาคาร</th><th>สาขา</th><th style={{ width: 150 }}>สมุดบัญชีเลขที่</th><th style={{ width: 130 }}>ชื่อย่อ</th><th style={{ width: 200 }}>เลขที่บัญชี (ผังบัญชี)</th><th style={{ width: 110 }}>เคลื่อนไหว</th><th style={{ width: 70 }}>สถานะ</th></tr></thead>
          <tbody>
            {list.data?.map((b) => (
              <tr key={b.id} className="row-open" tabIndex={0} onClick={() => setEdit(b)} onKeyDown={(e) => e.key === 'Enter' && setEdit(b)}>
                <td className="mono">{b.code}</td><td>{b.name}</td><td>{b.account_kind ? KIND[b.account_kind] : ''}</td><td className="mono">{b.bank_code}</td><td>{b.branch}</td>
                <td className="mono">{b.account_number}</td><td>{b.short_name}</td><td><span className="mono">{b.account_no}</span> <span className="muted small">{b.account_name}</span></td>
                <td>{b.gl_account_id && <button className="link" onClick={(e) => { e.stopPropagation(); nav(`/reports/ledger?account_id=${b.gl_account_id}${me?.work_date ? `&to=${me.work_date}` : ''}`); }}>ดูรายการ ›</button>}</td>
                <td>{b.status === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">เลิกใช้</Pill>}</td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={10} className="empty">ยังไม่มีบัญชีเงินฝาก — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <BankAccountForm b={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); }} />}
    </div>
  );
}

function BankAccountForm({ b, onClose, onSaved }: { b: BankAccount | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan('FI.BK.ACC');
  const lk = useLookups('BANK');
  const [f, setF] = useState({ code: b?.code ?? '', name: b?.name ?? '', bank_id: b?.bank_id ?? '', branch: b?.branch ?? '', account_number: b?.account_number ?? '', short_name: b?.short_name ?? '', account_kind: b?.account_kind ?? '', gl_account_id: b?.gl_account_id ?? null as string | null, opening_balance: b?.opening_balance ?? '', opening_date: b?.opening_date ?? '', status: b?.status ?? 'A' });
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState(false);
  const allowed = can(b ? 'edit' : 'add');
  const save = async () => {
    if (!allowed) return;
    setErr(null);
    const body = { ...f, bank_id: f.bank_id || null, opening_date: f.opening_date || null, opening_balance: f.opening_balance || null };
    try { if (b) await api.put(`/api/v1/bank-accounts/${b.id}`, body); else await api.post('/api/v1/bank-accounts', body); toast(`บันทึกบัญชีเงินฝาก ${f.code.toUpperCase()} แล้ว`); onSaved(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const t = (k: keyof typeof f, max: number) => ({ value: (f[k] as string) ?? '', maxLength: max, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Modal title={b ? `แก้ไขบัญชีเงินฝาก ${b.code}` : 'เพิ่มบัญชีเงินฝาก'} onClose={onClose}
      footer={<>{b && can('delete') && <button className="danger" onClick={() => setAsk(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!allowed} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={navKey}>
        <Field label="รหัสบัญชี" req hint="อักษรย่อ เช่น C1 = กระแสรายวันบัญชีที่ 1, S1, CC"><input autoFocus className="mono" {...t('code', 10)} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="ประเภทบัญชี"><select value={f.account_kind} onChange={(e) => setF({ ...f, account_kind: e.target.value })}><option value="">—</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></Field>
        <Field label="ชื่อบัญชีเงินฝาก" req wide hint="ตามสมุดบัญชี ควรสื่อความหมาย เช่น กระแสรายวัน ธ.กรุงเทพ 111222"><input {...t('name', 120)} /></Field>
        <Field label="ธนาคาร"><LkSelect byId rows={lk.data?.BANK} value={f.bank_id} onChange={(v) => setF({ ...f, bank_id: v })} /></Field>
        <Field label="สาขา"><input {...t('branch', 60)} /></Field>
        <Field label="สมุดบัญชีเลขที่" hint="เลขบัญชีธนาคาร (บัญชีเงินสดหลอกปล่อยว่าง)"><input className="mono" {...t('account_number', 30)} /></Field>
        <Field label="ชื่อย่อ" hint="ใช้ในรายงาน/ฟอร์ม เช่น BBL-CA"><input {...t('short_name', 20)} /></Field>
        <Field label="เลขที่บัญชี (ผังบัญชี)" req wide hint="ต้องสัมพันธ์กับประเภทบัญชี เช่น 1112-01 เงินฝากกระแสรายวัน · บัญชีหลอกผูก 1111-00 เงินสด"><AccountCell value={f.gl_account_id} onChange={(a) => setF((x) => ({ ...x, gl_account_id: a?.id ?? null }))} /></Field>
        <Field label="ยอดยกมาตาม statement"><MoneyInput value={f.opening_balance} onChange={(v) => setF({ ...f, opening_balance: v })} /></Field>
        <Field label="วันที่ยอดยกมา"><DateInput value={f.opening_date} onChange={(v) => setF({ ...f, opening_date: v })} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
      </div>
      {ask && b && <Confirm danger title="ลบบัญชีเงินฝาก" text={`ลบ ${b.code}? ลบได้เฉพาะบัญชีที่ยังไม่มีเช็ค/รายการโอน และไม่ได้ผูกกับวิธีรับ-จ่ายชำระ`} okText="ลบ" onClose={() => setAsk(false)}
        onOk={() => api.del(`/api/v1/bank-accounts/${b.id}`).then(() => { toast('ลบบัญชีเงินฝากแล้ว'); onSaved(); }).catch((e) => { setAsk(false); toastError(e); })} />}
    </Modal>
  );
}

/* ---------------------------------------------------------------- วิธีรับชำระหนี้ S-SET-06 / วิธีจ่ายชำระหนี้ S-SET-08 */
interface PM { id?: string; seq: string | null; code: string; name_th: string; name_en: string | null; kind: string; creates_cheque: boolean; gl_account_id: string | null; bank_account_id: string | null; status: string; used?: number }
const KINDS: Array<[string, string]> = [['CASH', 'เงินสด'], ['CHEQUE', 'เช็ค'], ['TRANSFER', 'เงินโอน'], ['CARD', 'บัตรเครดิต'], ['WHT', 'ภาษีหัก ณ ที่จ่าย'], ['DISCOUNT', 'ส่วนลด'], ['DEPOSIT', 'เงินมัดจำ'], ['FX', 'อัตราแลกเปลี่ยน'], ['OTHER', 'อื่น ๆ']];

export function PaymentMethodsPage() {
  const can = useCan('SET.PAYM');
  const qc = useQueryClient();
  const [dir, setDir] = useState<'R' | 'P'>('R');
  const list = useQuery({ queryKey: ['payment-methods', dir], queryFn: () => api.get<PM[]>(`/api/v1/payment-methods/${dir}`), staleTime: 0 });
  const banks = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<BankAccount[]>('/api/v1/bank-accounts') });
  const [rows, setRows] = useState<PM[] | null>(null);
  const [loaded, setLoaded] = useState<string>('');
  if (list.data && loaded !== dir + list.dataUpdatedAt) { setLoaded(dir + list.dataUpdatedAt); setRows(list.data.map((r) => ({ ...r }))); }
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!rows || busy || !can('edit')) return;
    setErr(null); setBusy(true);
    try {
      await api.put(`/api/v1/payment-methods/${dir}`, { rows: rows.map(({ used: _u, ...r }) => ({ ...r, seq: r.seq || null, name_en: r.name_en || null })) });
      toast(`บันทึกวิธี${dir === 'R' ? 'รับ' : 'จ่าย'}ชำระหนี้แล้ว`);
      qc.invalidateQueries({ queryKey: ['payment-methods', dir] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const set = (i: number, p: Partial<PM>) => setRows((rs) => rs!.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const bankRows = banks.data?.map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const dirty = JSON.stringify(rows) !== JSON.stringify(list.data);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › วิธีรับ/จ่ายชำระหนี้" title={dir === 'R' ? 'วิธีการรับชำระหนี้' : 'วิธีการจ่ายชำระหนี้'}
        lead={<>3 ลักษณะ: <b>เช็ค/บัตร</b> ที่ต้องนำฝากและรอผ่าน (ติ๊ก เช็ค? + บัญชีเช็ครับ/จ่ายล่วงหน้า) · <b>เงินโอน</b> เลือกธนาคาร (บัญชีเงินฝาก) ไม่ต้องป้อนเลขที่บัญชี · <b>อื่น ๆ</b> ที่เสร็จในขั้นตอนเดียว เช่น เงินสด ส่วนลด ภาษีหัก ณ ที่จ่าย ป้อนเฉพาะเลขที่บัญชี</>}
        actions={can('edit') && <button className="primary" disabled={busy || !dirty} onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <Tabs active={dir} onChange={(k) => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?')) { setDir(k as 'R'); setRows(null); setLoaded(''); } }}
        tabs={[{ key: 'R', label: 'วิธีการรับชำระหนี้ (ขายและลูกหนี้)' }, { key: 'P', label: 'วิธีการจ่ายชำระหนี้ (ซื้อและเจ้าหนี้)' }]} />
      <ErrorBox error={err ?? list.error} />
      {rows && <div className="table-wrap lines" onKeyDown={navKey}>
        <table className="grid">
          <thead><tr><th style={{ width: 60 }}>No.</th><th style={{ width: 60 }}>รหัส</th><th>คำอธิบายไทย</th><th>อังกฤษ</th><th style={{ width: 140 }}>ลักษณะ</th><th style={{ width: 60 }}>เช็ค?</th><th style={{ width: 170 }}>ธนาคาร (บัญชีเงินฝาก)</th><th style={{ width: 160 }}>เลขที่บัญชี</th><th style={{ width: 90 }}>สถานะ</th><th style={{ width: 36 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `n${i}`}>
                <td><input className="mono" value={r.seq ?? ''} maxLength={4} onChange={(e) => set(i, { seq: e.target.value })} aria-label="ลำดับ" /></td>
                <td><input className="mono" value={r.code} maxLength={2} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} aria-label="รหัส" /></td>
                <td><input value={r.name_th} maxLength={120} onChange={(e) => set(i, { name_th: e.target.value })} aria-label="คำอธิบายไทย" /></td>
                <td><input value={r.name_en ?? ''} maxLength={120} onChange={(e) => set(i, { name_en: e.target.value })} aria-label="คำอธิบายอังกฤษ" /></td>
                <td><select value={r.kind} onChange={(e) => set(i, { kind: e.target.value, creates_cheque: e.target.value === 'CHEQUE' || e.target.value === 'CARD' ? true : r.creates_cheque })} aria-label="ลักษณะ">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td className="c"><input type="checkbox" checked={r.creates_cheque} onChange={(e) => set(i, { creates_cheque: e.target.checked })} aria-label="ต้องผ่านกระบวนการนำฝาก/ผ่านเช็คภายหลัง" /></td>
                <td><LkSelect byId rows={bankRows} value={r.bank_account_id} onChange={(v) => set(i, { bank_account_id: v || null })} aria-label="ธนาคาร" /></td>
                <td><AccountCell value={r.gl_account_id} onChange={(a) => set(i, { gl_account_id: a?.id ?? null })} /></td>
                <td><select value={r.status} onChange={(e) => set(i, { status: e.target.value })} aria-label="สถานะ"><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></td>
                <td>{!Number(r.used) && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="empty">ยังไม่มีวิธีชำระ</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={10}><button type="button" onClick={() => setRows([...rows, { seq: String(rows.length + 1).padStart(2, '0'), code: '', name_th: '', name_en: null, kind: 'OTHER', creates_cheque: false, gl_account_id: null, bank_account_id: null, status: 'A' }])}>+ เพิ่มวิธีชำระ</button> <span className="hint">รหัส 2 ตัวนำหน้าเลขที่ในรายการชำระ เช่น QR TR TS · วิธีที่ใช้ในเอกสารแล้วลบไม่ได้ (เปลี่ยนเป็นเลิกใช้)</span></td></tr></tfoot>
        </table>
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหาบัญชี'], ['F9', 'บันทึก']]} />
    </div>
  );
}
