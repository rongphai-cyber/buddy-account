import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DOC_CLASSES, formatDocNo, GL_ROLES, JOURNAL_ROUTES, MODULE_TH, slotLabel } from '@buddy/core';
import { api, type Book, type Department } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { Confirm, ErrorBox, Field, KeyHints, Modal, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';

/* ---------------------------------------------------------------- เลขที่เอกสาร S-DN-01 */
interface DocTypeRow { id: string; code: string; doc_class: string; module: string; name_th: string; name_en: string | null; next_no: string; status: string; book_code: string | null; book_name: string | null; department_code: string | null; doc_count: number; account_count: number }

export function DocTypesPage() {
  const can = useCan('SET.DOCNO');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['doc-types'], queryFn: () => api.get<DocTypeRow[]>('/api/v1/doc-types') });
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  useHotkeys({ Insert: can('add') ? () => setEdit('new') : undefined }, []);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = (list.data ?? []).filter((r) => !s || r.code.toLowerCase().includes(s) || r.name_th.toLowerCase().includes(s) || r.doc_class.toLowerCase().includes(s));
    const m = new Map<string, DocTypeRow[]>();
    for (const r of rows) { if (!m.has(r.module)) m.set(r.module, []); m.get(r.module)!.push(r); }
    return [...m.entries()].sort(([a], [b]) => Object.keys(MODULE_TH).indexOf(a) - Object.keys(MODULE_TH).indexOf(b));
  }, [list.data, q]);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › กำหนดเลขที่เอกสาร" title="กำหนดเลขที่เอกสาร"
        lead="แต่ละประเภทเอกสารมีเลขที่รันของตัวเอง: ตัวนำหน้า + เลข 7 หลัก ไม่มีเครื่องหมายคั่น และไม่เริ่มใหม่เมื่อขึ้นปีบัญชี · หมวดเดียวกันแยกได้หลายประเภท (เช่น ขายเชื่อในประเทศ/ต่างประเทศ) · คลิกเพื่อตั้งสมุดรายวัน แผนก บัญชีเฉพาะเอกสาร และค่าควบคุม"
        actions={can('add') && <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มประเภทเอกสาร <kbd>Ins</kbd></button>} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาหมวด ตัวนำหน้า หรือชื่อเอกสาร" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาประเภทเอกสาร" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 60 }}>หมวด</th><th>ชื่อเอกสาร</th><th>ชื่อภาษาอังกฤษ</th><th style={{ width: 150 }}>เลขที่ถัดไป</th><th style={{ width: 180 }}>สมุดรายวัน</th><th style={{ width: 70 }}>แผนก</th><th className="r" style={{ width: 90 }}>เอกสาร</th><th style={{ width: 80 }}>สถานะ</th></tr></thead>
          {groups.map(([mod, rows]) => (
            <tbody key={mod}>
              <tr className="group-row"><td colSpan={8}><b>{MODULE_TH[mod] ?? mod}</b></td></tr>
              {rows.map((r) => (
                <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setEdit(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEdit(r.id)}>
                  <td className="mono">{r.doc_class}</td><td>{r.name_th}{r.account_count > 0 && <span className="muted small"> · บัญชีเฉพาะ {r.account_count}</span>}</td><td className="muted">{r.name_en}</td>
                  <td className="mono"><b>{formatDocNo(r.code, r.next_no)}</b></td><td>{r.book_code ? `${r.book_code} ${r.book_name}` : <span className="muted">ไม่ลงบัญชี</span>}</td>
                  <td className="mono">{r.department_code}</td><td className="r">{Number(r.doc_count).toLocaleString()}</td><td>{r.status === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">เลิกใช้</Pill>}</td>
                </tr>
              ))}
            </tbody>
          ))}
          {list.data && !groups.length && <tbody><tr><td colSpan={8} className="empty">ไม่พบ</td></tr></tbody>}
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'แก้ไขรายละเอียดเอกสาร'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <DocTypeForm id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['doc-types'] }); }} />}
    </div>
  );
}

/* ---------------------------------------------------------------- รายละเอียดเอกสาร S-DN-02 */
interface DocTypeDetail extends Record<string, unknown> { id: string; code: string; doc_class: string; next_no: string; accounts: Array<{ slot: number; account_id: string }>; doc_count: number; last_doc_no: string | null }
type F = Record<string, string | boolean | null>;
const KEYS = ['code', 'doc_class', 'name_th', 'name_en', 'short_name', 'next_no', 'journal_book_id', 'department_id', 'warehouse_id', 'journal_desc_template', 'price_type', 'vat_rate', 'vat_basis', 'approve_level', 'approve_method', 'reprint_level', 'cancel_level', 'delete_level', 'over_limit_level', 'form_no', 'status'];
const BOOLS = ['vat_per_line', 'auto_print', 'use_barcode'];

function DocTypeForm({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan('SET.DOCNO');
  const lk = useLookups('WH');
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const cur = useQuery({ enabled: !!id, queryKey: ['doc-type', id], queryFn: () => api.get<DocTypeDetail>(`/api/v1/doc-types/${id}`), staleTime: 0 });
  const [f, setF] = useState<F | null>(id ? null : { ...Object.fromEntries(KEYS.map((k) => [k, ''])), doc_class: 'IV', next_no: '1', status: 'A', vat_per_line: false, auto_print: false, use_barcode: false });
  const [accs, setAccs] = useState<Record<number, string | null>>({});
  const [extraSlots, setExtraSlots] = useState<number[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState(false);
  if (id && cur.data && !f) {
    setF({ ...Object.fromEntries(KEYS.map((k) => [k, cur.data[k] === null || cur.data[k] === undefined ? '' : String(cur.data[k])])), ...Object.fromEntries(BOOLS.map((k) => [k, !!cur.data[k]])), next_no: String(cur.data.next_no).padStart(7, '0') });
    setAccs(Object.fromEntries(cur.data.accounts.map((x) => [x.slot, x.account_id])));
  }
  const set = (p: F) => setF((x) => ({ ...x!, ...p }));
  const allowed = can(id ? 'edit' : 'add');
  const save = async () => {
    if (!f || !allowed) return;
    setErr(null);
    const body = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])), next_no: f.next_no || '1',
      accounts: Object.entries(accs).filter(([, v]) => v).map(([slot, account_id]) => ({ slot: Number(slot), account_id })) };
    try { if (id) await api.put(`/api/v1/doc-types/${id}`, body); else await api.post('/api/v1/doc-types', body); toast(`บันทึกประเภทเอกสาร ${String(f.code).toUpperCase()} แล้ว`); onSaved(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const t = (k: string, max: number) => ({ value: (f?.[k] as string) ?? '', maxLength: max, onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }) });
  const cls = String(f?.doc_class ?? '');
  const slots = [...new Set([...Object.keys(accs).map(Number), ...extraSlots])].sort((a, b) => a - b);
  const levelSel = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><select value={(f?.[k] as string) ?? ''} onChange={(e) => set({ [k]: e.target.value })}><option value="">ตามค่าเริ่มต้น</option>{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}{n === 0 ? ' ไม่ต้องขออนุมัติ' : ''}</option>)}</select></Field>;
  return (
    <Modal title={id ? `รายละเอียดเอกสาร ${cur.data?.code ?? ''}` : 'เพิ่มประเภทเอกสาร'} size="wide" onClose={onClose}
      footer={<>{id && can('delete') && <button className="danger" onClick={() => setAsk(true)}>ลบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!f || !allowed} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? cur.error} />
      {f && <div onKeyDown={navKey}>
        <fieldset className="box"><legend>เอกสาร</legend>
          <div className="form-grid party-grid">
            <Field label="หมวดเอกสาร" req hint="กำหนดตรรกะของเอกสาร — เปลี่ยนไม่ได้เมื่อมีเอกสารแล้ว"><select value={cls} disabled={!!cur.data?.doc_count} onChange={(e) => set({ doc_class: e.target.value })}>{Object.entries(DOC_CLASSES).map(([k, v]) => <option key={k} value={k}>{k} {v.label}</option>)}</select></Field>
            <Field label="ชื่อเอกสาร" req><input autoFocus {...t('name_th', 120)} /></Field>
            <Field label="Eng."><input {...t('name_en', 120)} /></Field>
            <Field label="เลขที่ถัดไป: ตัวนำหน้า" req hint="1–4 ตัว ไม่มีเครื่องหมายคั่น"><input className="mono" {...t('code', 4)} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="เลขที่ถัดไป: เลข" req hint={cur.data?.last_doc_no ? `เลขล่าสุดที่ใช้ ${cur.data.last_doc_no}` : 'ต่อจากระบบเดิมได้ เช่น 101'}><input className="mono" inputMode="numeric" {...t('next_no', 7)} onChange={(e) => set({ next_no: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="ตัวอย่างเลขที่"><input readOnly className="mono" value={f.code && f.next_no ? formatDocNo(String(f.code), String(f.next_no).replace(/^0+/, '') || '1') : ''} /></Field>
            <Field label="บันทึกบัญชี ลงสมุดรายวัน" hint="ว่าง = ไม่ลงบัญชี (เช่น ใบเสนอราคา ใบสั่งขาย ใบวางบิล)"><select value={(f.journal_book_id as string) ?? ''} onChange={(e) => set({ journal_book_id: e.target.value })}><option value="">—</option>{books.data?.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name_th}</option>)}</select></Field>
            <Field label="แผนก" hint="เติมรหัสแผนกอัตโนมัติเมื่อป้อนเอกสารนี้"><select value={(f.department_id as string) ?? ''} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.filter((d) => d.status === 'A' || d.id === f.department_id).map((d) => <option key={d.id} value={d.id}>{d.code} {d.name_th}</option>)}</select></Field>
            <Field label="ชื่อย่อ"><input {...t('short_name', 10)} /></Field>
            <Field label="คำอธิบายในสมุดรายวัน" wide hint="ข้อความ + ช่องข้อมูลของเอกสาร เช่น ขายเชื่อให้ {party.name} · ว่าง = ใช้ชื่อเอกสาร + ชื่อคู่ค้า"><input {...t('journal_desc_template', 200)} placeholder="ขายเชื่อให้ {party.name}" /></Field>
          </div>
        </fieldset>
        <fieldset className="box"><legend>วิธีการบันทึกบัญชี (เฉพาะเอกสารนี้)</legend>
          <p className="hint">ว่างไว้ = ใช้บัญชีจากแฟ้มหลัก (ลูกค้า สินค้า→กลุ่มบัญชี บัญชีเงินฝาก) แล้วจึงใช้ เริ่มระบบ › การเชื่อมต่อบัญชี › บัญชีเพื่อลงรายวัน — กำหนดเฉพาะเมื่อต้องการบัญชีเจาะจง</p>
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>ช่อง</th><th style={{ width: 260 }}>ความหมาย</th><th>เลขที่บัญชี</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {slots.map((s) => <tr key={s}><td className="mono">{s}</td><td>{slotLabel(cls, s)}</td><td><AccountCell value={accs[s] ?? null} onChange={(a) => setAccs((x) => ({ ...x, [s]: a?.id ?? null }))} /></td>
                <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบ" onClick={() => { setAccs((x) => { const n = { ...x }; delete n[s]; return n; }); setExtraSlots((x) => x.filter((y) => y !== s)); }}>✕</button></td></tr>)}
              {!slots.length && <tr><td colSpan={4} className="empty">ไม่ได้กำหนดบัญชีเฉพาะ — ใช้บัญชีจากแฟ้มหลักและบัญชีเพื่อลงรายวัน</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={4}>
              <select value="" onChange={(e) => { const n = Number(e.target.value); if (n) setExtraSlots((x) => [...x, n]); }} aria-label="เพิ่มช่องบัญชี" style={{ width: 'auto' }}>
                <option value="">+ เพิ่มบัญชีเฉพาะเอกสาร…</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => !slots.includes(n)).map((n) => <option key={n} value={n}>ช่องที่ {n} — {slotLabel(cls, n)}</option>)}
              </select>
            </td></tr></tfoot>
          </table>
        </fieldset>
        <fieldset className="box"><legend>ค่าควบคุม (ว่าง = ตามค่าเริ่มต้นแต่ละระบบ)</legend>
          <div className="form-grid party-grid">
            <Field label="ประเภทราคา"><select value={(f.price_type as string) ?? ''} onChange={(e) => set({ price_type: e.target.value })}><option value="">ตามค่าเริ่มต้น</option><option value="0">0 ยกเว้นภาษี</option><option value="1">1 ราคารวมภาษี</option><option value="2">2 ราคาไม่รวมภาษี</option></select></Field>
            <Field label="อัตราภาษี (%)"><input type="number" min={0} max={30} step="0.01" {...t('vat_rate', 6)} /></Field>
            <Field label="ภาระภาษีขาย (สินค้าบริการ)"><select value={(f.vat_basis as string) ?? ''} onChange={(e) => set({ vat_basis: e.target.value })}><option value="">ตามค่าเริ่มต้น</option><option value="1">เกณฑ์สิทธิ</option><option value="2">เกณฑ์เงินสด</option><option value="3">ให้ผู้ใช้เลือกตอนเปิดบิล</option></select></Field>
            {levelSel('approve_level', 'รับรองเอกสาร ต้องขออนุมัติระดับ')}
            <Field label="วิธีการพิมพ์ หรือรับรองเอกสาร"><select value={(f.approve_method as string) ?? ''} onChange={(e) => set({ approve_method: e.target.value })}><option value="">ตามค่าเริ่มต้น</option><option value="1">1 พิมพ์ก่อนรับรอง</option><option value="2">2 รับรองก่อนพิมพ์</option></select></Field>
            {levelSel('reprint_level', 'พิมพ์เอกสารซ้ำ ต้องขออนุมัติระดับ')}
            {levelSel('cancel_level', 'ยกเลิกเอกสาร ต้องขออนุมัติระดับ')}
            {levelSel('over_limit_level', 'เกินวงเงิน ต้องขออนุมัติระดับ')}
            <Field label="รหัสคลังสินค้าที่จะตัด"><LkSelect byId rows={lk.data?.WH} value={f.warehouse_id as string} onChange={(v) => set({ warehouse_id: v })} blank="ตามค่าเริ่มต้น" /></Field>
            <Field label="ฟอร์มที่ใช้พิมพ์"><select value={(f.form_no as string) ?? ''} onChange={(e) => set({ form_no: e.target.value })}><option value="">ฟอร์มมาตรฐาน</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>ฟอร์มที่ {n}</option>)}</select></Field>
            <Field label="ตัวเลือก"><div className="checks">
              <label className="check"><input type="checkbox" checked={!!f.vat_per_line} onChange={(e) => set({ vat_per_line: e.target.checked })} /> แยกประเภท VAT ที่รายการสินค้า</label>
              <label className="check"><input type="checkbox" checked={!!f.auto_print} onChange={(e) => set({ auto_print: e.target.checked })} /> พิมพ์อัตโนมัติหลังบันทึก</label>
              <label className="check"><input type="checkbox" checked={!!f.use_barcode} onChange={(e) => set({ use_barcode: e.target.checked })} /> ป้อนรายการด้วยบาร์โค้ด</label>
            </div></Field>
            <Field label="สถานะ"><select value={(f.status as string) ?? 'A'} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
          </div>
        </fieldset>
      </div>}
      {ask && id && <Confirm danger title="ลบประเภทเอกสาร" text={`ลบ ${cur.data?.code}? ลบได้เฉพาะประเภทที่ยังไม่มีเอกสาร`} okText="ลบ" onClose={() => setAsk(false)}
        onOk={() => api.del(`/api/v1/doc-types/${id}`).then(() => { toast('ลบประเภทเอกสารแล้ว'); onSaved(); }).catch((e) => { setAsk(false); toastError(e); })} />}
    </Modal>
  );
}

/* ---------------------------------------------------------------- การเชื่อมต่อบัญชี S-GL-01 / S-GL-02 */
interface Link { link_gl: boolean; routes: Array<{ txn_kind: string; journal_book_id: string }>; defaults: Array<{ role: string; account_id: string }> }
export function GlLinkPage() {
  const can = useCan('SET.LINK');
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ['gl-link'], queryFn: () => api.get<Link>('/api/v1/gl/link'), staleTime: 0 });
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const [tab, setTab] = useState('routes');
  const [st, setSt] = useState<{ link: boolean; routes: Record<string, string | null>; defaults: Record<string, string | null> } | null>(null);
  const [stamp, setStamp] = useState(0);
  if (cur.data && stamp !== cur.dataUpdatedAt) { setStamp(cur.dataUpdatedAt); setSt({ link: cur.data.link_gl, routes: Object.fromEntries(cur.data.routes.map((r) => [r.txn_kind, r.journal_book_id])), defaults: Object.fromEntries(cur.data.defaults.map((r) => [r.role, r.account_id])) }); }
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    if (!st || !can('edit')) return;
    setErr(null);
    try {
      await api.put('/api/v1/gl/link', { link_gl: st.link, routes: JOURNAL_ROUTES.map((r) => ({ txn_kind: r.kind, journal_book_id: st.routes[r.kind] || null })), defaults: GL_ROLES.map((r) => ({ role: r.role, account_id: st.defaults[r.role] || null })) });
      toast('บันทึกการเชื่อมต่อบัญชีแล้ว'); qc.invalidateQueries({ queryKey: ['gl-link'] });
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const bookSel = (kind: string) => <select value={st?.routes[kind] ?? ''} onChange={(e) => setSt((x) => x && ({ ...x, routes: { ...x.routes, [kind]: e.target.value || null } }))} aria-label={kind}><option value="">—</option>{books.data?.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name_th}</option>)}</select>;
  const sections = [...new Set(GL_ROLES.map((r) => r.section))];
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › การเชื่อมต่อบัญชี" title="กำหนดการเชื่อมต่อบัญชี"
        lead="ลำดับการหาเลขที่บัญชีเมื่อลงรายวันอัตโนมัติ: 1 บัญชีที่ประเภทเอกสาร (เลขที่เอกสาร) → 2 แฟ้มหลัก (ลูกค้า ผู้จำหน่าย สินค้า→กลุ่มบัญชี บัญชีเงินฝาก) → 3 บัญชีเพื่อลงรายวันในหน้านี้"
        actions={can('edit') && <button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <ErrorBox error={err ?? cur.error} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'routes', label: '1. การผ่านรายการไปสมุดบัญชี' }, { key: 'defaults', label: '2. บัญชีเพื่อลงรายวัน' }]} />
      {st && tab === 'routes' && <div onKeyDown={navKey}>
        <fieldset className="box">
          <label className="check"><input type="checkbox" checked={st.link} onChange={(e) => setSt({ ...st, link: e.target.checked })} /> <b>เชื่อมต่อระบบบัญชี</b> — ส่งรายการจากระบบซื้อ ขาย การเงิน สินค้า ไปลงสมุดรายวันอัตโนมัติ</label>
          {!st.link && <p className="bad small">ไม่ติ๊ก = เอกสารจะไม่ลงบัญชี และเมื่อเปลี่ยนกลับเป็นติ๊ก ระบบไม่ลงบัญชีย้อนหลังให้ ต้องสั่งลงบัญชีใหม่ที่เอกสารแต่ละรายการ</p>}
        </fieldset>
        <fieldset className="box"><legend>รายการผ่านไปสมุดรายวัน</legend>
          <div className="form-grid party-grid">{JOURNAL_ROUTES.filter((r) => r.main).map((r) => <Field key={r.kind} label={r.label}>{bookSel(r.kind)}</Field>)}</div>
          <p className="hint">รายการนอกเหนือจากนี้ กำหนดสมุดรายวันที่ เริ่มระบบ › เลขที่เอกสาร (รายละเอียดเอกสารแต่ละประเภท)</p>
        </fieldset>
        <details className="box"><summary>สมุดรายวันสำรองตามประเภทรายการ (ใช้เมื่อประเภทเอกสารไม่ได้กำหนดสมุด)</summary>
          <div className="form-grid party-grid">{JOURNAL_ROUTES.filter((r) => !r.main).map((r) => <Field key={r.kind} label={r.label}>{bookSel(r.kind)}</Field>)}</div>
        </details>
      </div>}
      {st && tab === 'defaults' && <div onKeyDown={navKey}>
        <p className="hint">ใช้เมื่อเอกสารและแฟ้มหลักไม่ได้กำหนดบัญชี · ถ้าเปลี่ยนเลขที่บัญชีในผังบัญชีที่เกี่ยวข้อง ต้องกลับมาแก้ที่นี่ให้ตรงด้วย · บัญชีพักต้องมีในผังบัญชีและไม่ใช้บันทึกรายการใด ๆ</p>
        {sections.map((sec) => <fieldset key={sec} className="box"><legend>{sec}</legend>
          <div className="form-grid party-grid">{GL_ROLES.filter((r) => r.section === sec).map((r) => <Field key={r.role} label={r.label} req={r.role === 'SUSPENSE' || r.role === 'RETAINED_EARNINGS'} hint={r.hint}>
            <AccountCell value={st.defaults[r.role] ?? null} onChange={(a) => setSt((x) => x && ({ ...x, defaults: { ...x.defaults, [r.role]: a?.id ?? null } }))} />
          </Field>)}</div>
        </fieldset>)}
      </div>}
      <KeyHints keys={[['F4', 'ค้นหาบัญชี'], ['F9', 'บันทึก']]} />
    </div>
  );
}
