import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { d, fmt, journalTotals, todayIso, formatDate } from '@buddy/core';
import { api, type Book, type Department, type Template, type TemplateDetail } from '../../api';
import { useSession } from '../../session';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Lookup, Modal, Money, MoneyInput, navKey, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { TemplateForm, templateToLines, useTemplates } from './Templates';

interface Line { key: number; account_id: string | null; department_id: string | null; description: string; debit: string; credit: string }
interface JournalDoc {
  id: string; voucher_no: string; voucher_date: string; description: string | null; reference: string | null; journal_book_id: string; doc_status: string; editable: boolean;
  source_module: string | null; source_doc_no: string | null; source_doc_class: string | null; created_at: string; updated_at: string; created_by_name: string | null;
  lines: Array<{ account_id: string; department_id: string | null; description: string | null; debit: string; credit: string; account_no: string; account_name: string; posting_role: string | null; resolved_from: string | null }>;
}
let seq = 0;
const blank = (): Line => ({ key: ++seq, account_id: null, department_id: null, description: '', debit: '', credit: '' });

/** สมุดรายวัน (JV และเล่มอื่น) — คู่มือบทที่ 15 S-GL-02 */
export function JournalFormPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();
  const books = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/v1/gl/books') });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const accts = useAccounts();
  const doc = useQuery({ enabled: !isNew, queryKey: ['journal', id], queryFn: () => api.get<JournalDoc>(`/api/v1/gl/journals/${id}`) });
  const [h, setH] = useState({ journal_book_id: sp.get('book') ?? '', voucher_date: me?.work_date ?? todayIso(), description: '', reference: '' });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState('lines');
  const [cancelAsk, setCancelAsk] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextNo, setNextNo] = useState('');
  const [saves, setSaves] = useState(0); // นับครั้งที่บันทึก — ให้ดึงเลขที่ถัดไปใหม่หลัง "บันทึก+ใหม่"
  const gridRef = useRef<HTMLDivElement>(null);
  const editable = isNew || !!doc.data?.editable;
  // ต้นแบบวิธีการบันทึก (S-GL-05): เลือกจาก 🔍/F4 ที่ช่องเลขที่ใบสำคัญ หรือขึ้นอัตโนมัติตามต้นแบบของสมุด (S-GL-09)
  const templates = useTemplates();
  const [tplPick, setTplPick] = useState<string | null>(null);
  const [tplAdd, setTplAdd] = useState<string | null>(null);
  const [tplReplace, setTplReplace] = useState<TemplateDetail | null>(null);
  const bookTplId = isNew ? books.data?.find((b) => b.id === h.journal_book_id)?.template_id ?? null : null;
  const bookTpl = useQuery({ enabled: !!bookTplId, queryKey: ['template', bookTplId], queryFn: () => api.get<TemplateDetail>(`/api/v1/gl/templates/${bookTplId}`) });
  const freshLines = (t?: TemplateDetail | null): Line[] => (t?.lines.length ? templateToLines(t).map((l) => ({ ...l, key: ++seq })) : [blank(), blank()]);
  const linesBlank = lines.every((l) => !l.account_id && !l.debit && !l.credit && !l.description);
  const applyTemplate = (t: TemplateDetail) => {
    setLines(freshLines(t)); setDirty(true); setTplReplace(null);
    const missing = t.lines.some((l) => !l.amount || d(l.amount).isZero());
    toast(`ใช้ต้นแบบ ${t.code} แล้ว${missing ? ' — ป้อนจำนวนเงินที่ยังว่าง' : ''}`);
    // ไปที่ช่องจำนวนเงินแรกที่ยังว่าง (ไม่มีก็ไปช่องคำอธิบาย)
    setTimeout(() => {
      const g = gridRef.current;
      const firstEmpty = missing ? [...(g?.querySelectorAll<HTMLInputElement>('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll<HTMLInputElement>('input.num')]).find((xs) => xs.every((x) => !x.value))?.[0] : undefined;
      (firstEmpty ?? document.querySelector<HTMLInputElement>('.head-grid .col:nth-child(2) input'))?.focus();
    }, 0);
  };
  const pickTemplate = async (tid: string) => {
    setTplPick(null);
    try {
      const t = await qc.fetchQuery({ queryKey: ['template', tid], queryFn: () => api.get<TemplateDetail>(`/api/v1/gl/templates/${tid}`), staleTime: 0 });
      if (linesBlank) applyTemplate(t); else setTplReplace(t);
    } catch (e) { toastError(e); }
  };
  useEffect(() => {
    if (isNew && bookTpl.data && linesBlank) setLines(freshLines(bookTpl.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, bookTpl.data]);

  useEffect(() => {
    if (isNew && !h.journal_book_id && books.data?.length) setH((x) => ({ ...x, journal_book_id: books.data!.find((b) => b.code === '00')?.id ?? books.data![0]!.id }));
  }, [books.data, isNew, h.journal_book_id]);
  useEffect(() => {
    if (!doc.data) return;
    setH({ journal_book_id: doc.data.journal_book_id, voucher_date: doc.data.voucher_date, description: doc.data.description ?? '', reference: doc.data.reference ?? '' });
    setLines(doc.data.lines.map((l) => ({ key: ++seq, account_id: l.account_id, department_id: l.department_id, description: l.description ?? '', debit: d(l.debit).isZero() ? '' : l.debit, credit: d(l.credit).isZero() ? '' : l.credit })));
    setDirty(false);
  }, [doc.data]);
  useEffect(() => {
    if (!isNew || !h.journal_book_id || !h.voucher_date) return;
    api.get<{ voucher_no: string }>('/api/v1/gl/journals-next-no', { book_id: h.journal_book_id, date: h.voucher_date }).then((r) => setNextNo(r.voucher_no)).catch(() => setNextNo(''));
  }, [isNew, h.journal_book_id, h.voucher_date, saves]);

  const totals = useMemo(() => journalTotals(lines), [lines]);
  const setLine = (k: number, p: Partial<Line>) => { setDirty(true); setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l))); };
  const addLine = () => {
    // บรรทัดใหม่: ใส่ยอดต่างให้อัตโนมัติด้านตรงข้าม และคำอธิบายเดิม (เหมือนเขียนใบสำคัญด้วยมือ)
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      const n = blank();
      setLines((ls) => {
        const diff = journalTotals(ls).diff;
        if (!diff.isZero()) { if (diff.isPositive()) n.credit = diff.toFixed(2); else n.debit = diff.neg().toFixed(2); }
        n.description = ls.at(-1)?.description ?? '';
        return [...ls, n];
      });
      setTimeout(() => gridRef.current?.querySelector<HTMLInputElement>(`tr[data-k="${n.key}"] input`)?.focus(), 0);
    }, 0);
  };
  const delLine = (k: number) => { setDirty(true); setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== k) : [blank()])); };

  const save = async (andNew = false) => {
    if (!editable || busy) return;
    setErr(null); setBusy(true);
    const body = { ...h, description: h.description || null, reference: h.reference || null, lines: lines.map((l) => ({ account_id: l.account_id, department_id: l.department_id, description: l.description || null, debit: l.debit || '0', credit: l.credit || '0' })) };
    try {
      const r = isNew ? await api.post<{ id: string; voucher_no: string }>('/api/v1/gl/journals', body) : await api.put<{ id: string; voucher_no: string }>(`/api/v1/gl/journals/${id}`, body);
      toast(`บันทึกใบสำคัญ ${r.voucher_no} แล้ว`); setSaves((n) => n + 1);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['journals'] }); qc.invalidateQueries({ queryKey: ['journal', r.id] }); qc.invalidateQueries({ queryKey: ['accounts', 'bal'] });
      if (andNew || isNew) { setLines(andNew ? freshLines(bookTpl.data) : [blank(), blank()]); setH((x) => ({ ...x, description: '', reference: '' })); if (!andNew) nav(`/gl/journals/${r.id}`, { replace: true }); else nav(`/gl/journals/new?book=${h.journal_book_id}`, { replace: true }); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const leave = (to: string) => (dirty && editable ? setLeaveAsk(to) : nav(to));
  useHotkeys({
    F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': () => !isNew && editable && setCancelAsk(true),
    'Alt+P': () => window.print(), 'Ctrl+Insert': addLine, 'Alt+N': () => leave('/gl/journals/new'), Escape: () => leave(`/gl/journals${h.journal_book_id ? `?book=${h.journal_book_id}` : ''}`),
  }, [h, lines, editable, dirty, busy]);

  const acctOf = (aid: string | null) => accts.data?.find((a) => a.id === aid);
  const issueLines = new Set(((err as { issues?: Array<{ line?: number }> })?.issues ?? []).map((i) => i.line).filter((x) => x !== undefined));
  const book = books.data?.find((b) => b.id === h.journal_book_id);
  const j = doc.data;
  return (
    <div className="page" data-tone="gl">
      <div className="doc-title">
        <div>
          <p className="eyebrow">บัญชี › ลงประจำวัน › {book ? `${book.code} ${book.name_th}` : 'สมุดรายวัน'}</p>
          <h1 className="mono">{isNew ? (nextNo || 'ใบสำคัญใหม่') : j?.voucher_no}</h1>
        </div>
        <div className="doc-state">
          {isNew && <Pill tone="d">ใหม่ — ยังไม่บันทึก</Pill>}
          {j && j.doc_status === 'C' && <Pill tone="c">ยกเลิกแล้ว</Pill>}
          {j && j.doc_status === 'N' && <Pill tone="m">ลงบัญชีแล้ว</Pill>}
          {j && !j.editable && j.doc_status === 'N' && <Pill tone="x">มาจาก {j.source_doc_class ?? j.source_module ?? 'ระบบอื่น'} {j.source_doc_no ?? ''} — แก้ที่เอกสารต้นทาง</Pill>}
          {dirty && editable && <Pill tone="d">มีการแก้ไขที่ยังไม่บันทึก</Pill>}
        </div>
      </div>
      <div className="toolbar" role="toolbar" aria-label="แถบเครื่องมือ">
        <div className="tb-group">
          <button onClick={() => leave('/gl/journals/new' + (h.journal_book_id ? `?book=${h.journal_book_id}` : ''))} title="ใบใหม่ (Alt+N)">+ ใหม่</button>
          <button className="primary" disabled={!editable || busy} onClick={() => save()} title="บันทึก (F9 / Ctrl+S)">บันทึก <kbd>F9</kbd></button>
          <button disabled={!editable || busy} onClick={() => save(true)} title="บันทึกแล้วขึ้นใบใหม่ (Ctrl+Enter)">บันทึก+ใหม่</button>
        </div>
        <div className="tb-group">
          <button disabled={isNew || !editable} onClick={() => setCancelAsk(true)} title="ยกเลิกเอกสาร (Alt+C)">ยกเลิกเอกสาร</button>
          <button onClick={() => window.print()} title="พิมพ์ (Alt+P)">พิมพ์</button>
        </div>
        <div className="tb-group"><button onClick={() => leave(`/gl/journals${h.journal_book_id ? `?book=${h.journal_book_id}` : ''}`)} title="กลับไปรายการ (Esc)">รายการ <kbd>Esc</kbd></button></div>
      </div>
      <ErrorBox error={err ?? doc.error} />
      <fieldset disabled={!editable} onKeyDown={navKey}>
        <div className="head-grid">
          <div className="col">
            <Field label="สมุดรายวัน" req>
              <select value={h.journal_book_id} onChange={(e) => { setDirty(true); setH({ ...h, journal_book_id: e.target.value }); }} disabled={!isNew}>
                {books.data?.map((b) => <option key={b.id} value={b.id}>{b.code} {b.prefix} · {b.name_th}</option>)}
              </select>
            </Field>
            <Field label="วันที่" req><DateInput value={h.voucher_date} onChange={(v) => { setDirty(true); setH({ ...h, voucher_date: v }); }} autoFocus={isNew} /></Field>
            <Field label="เลขที่ใบสำคัญ" hint={isNew ? 'ออกเลขอัตโนมัติตอนบันทึก · 🔍/F4 เลือกต้นแบบวิธีการบันทึก' : undefined}>
              <span className="lk-in">
                <input readOnly value={isNew ? nextNo : j?.voucher_no ?? ''} className="mono" onKeyDown={(e) => { if (isNew && e.key === 'F4') { e.preventDefault(); setTplPick(''); } }} />
                {isNew && <button type="button" className="icon-btn" onClick={() => setTplPick('')} title="เลือกต้นแบบวิธีการบันทึก (F4)">🔍</button>}
              </span>
            </Field>
            <Field label="อ้างอิง"><input value={h.reference} maxLength={30} onChange={(e) => { setDirty(true); setH({ ...h, reference: e.target.value }); }} /></Field>
          </div>
          <div className="col">
            <Field label="คำอธิบาย" wide><input value={h.description} maxLength={200} onChange={(e) => { setDirty(true); setH({ ...h, description: e.target.value }); }} /></Field>
            <div className="totals wide">
              <span>เดบิต <b className="num">{fmt(totals.debit)}</b></span>
              <span>เครดิต <b className="num">{fmt(totals.credit)}</b></span>
              <span className={cx(!totals.diff.isZero() && 'bad')}>ต่าง <b className="num">{fmt(totals.diff.abs())}</b></span>
              {totals.balanced ? <span className="ok">ดุล ✓</span> : <span className="bad">ยังไม่ดุล</span>}
            </div>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการบัญชี', badge: lines.filter((l) => l.account_id).length }, ...(!isNew ? [{ key: 'history', label: 'ประวัติการแก้ไข' }] : [])]} />
        {tab === 'lines' && (
          <div className="table-wrap lines" ref={gridRef} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).dataset.last != null && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); addLine(); } }}>
            <table className="grid">
              <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 170 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 110 }}>แผนก</th><th>คำอธิบายรายการ</th><th className="r" style={{ width: 140 }}>เดบิต</th><th className="r" style={{ width: 140 }}>เครดิต</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const a = acctOf(l.account_id);
                  return (
                    <tr key={l.key} data-k={l.key} className={cx(issueLines.has(i) && 'has-err')}>
                      <td className="muted">{i + 1}</td>
                      <td><AccountCell value={l.account_id} invalid={issueLines.has(i) && !l.account_id} onChange={(acc) => setLine(l.key, { account_id: acc?.id ?? null, department_id: acc?.use_department ? l.department_id : l.department_id })} /></td>
                      <td className="small">{a ? a.name_th : <span className="muted">—</span>}</td>
                      <td>
                        <select value={l.department_id ?? ''} onChange={(e) => setLine(l.key, { department_id: e.target.value || null })} aria-invalid={(a?.use_department && !l.department_id) || undefined}>
                          <option value="">{a?.use_department ? 'ต้องเลือก' : '—'}</option>
                          {depts.data?.filter((x) => x.status === 'A').map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                        </select>
                      </td>
                      <td><input value={l.description} maxLength={200} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                      <td><MoneyInput value={l.debit} onChange={(v) => setLine(l.key, { debit: v, credit: v ? '' : l.credit })} /></td>
                      <td><MoneyInput value={l.credit} onChange={(v) => setLine(l.key, { credit: v, debit: v ? '' : l.debit })} {...(i === lines.length - 1 ? { 'data-last': '' } : {})} /></td>
                      <td><button type="button" className="icon-btn" tabIndex={-1} onClick={() => delLine(l.key)} title="ลบบรรทัด">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={5}><button type="button" onClick={addLine}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button> <span className="hint">Enter ที่ช่องเครดิตบรรทัดสุดท้ายเพิ่มบรรทัดใหม่พร้อมยอดต่าง</span></td><td className="r num">{fmt(totals.debit)}</td><td className="r num">{fmt(totals.credit)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </fieldset>
      {tab === 'history' && id && <History table="gl_journal" rowId={id} />}
      {j && <p className="hint">สร้างโดย {j.created_by_name ?? 'นำเข้าจาก Express'} · <DateText v={j.created_at.slice(0, 10)} /> · แก้ไขล่าสุด <DateText v={j.updated_at.slice(0, 10)} /></p>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F4', 'ค้นหาบัญชี / ต้นแบบ (ที่ช่องเลขที่)'], ['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Ctrl+Ins', 'เพิ่มบรรทัด'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Alt+P', 'พิมพ์'], ['Esc', 'กลับรายการ']]} />
      <PrintVoucher title={book?.name_th ?? 'ใบสำคัญ'} no={isNew ? nextNo : j?.voucher_no ?? ''} date={formatDate(h.voucher_date, me?.company?.year_system ?? 'B')} desc={h.description} company={me?.company?.name_th ?? ''}
        lines={lines.filter((l) => l.account_id).map((l) => ({ no: acctOf(l.account_id)?.account_no ?? '', name: acctOf(l.account_id)?.name_th ?? '', desc: l.description, dr: l.debit, cr: l.credit }))} totals={totals} />
      {cancelAsk && <CancelDialog onClose={() => setCancelAsk(false)} onOk={(reason) => api.post(`/api/v1/gl/journals/${id}/cancel`, { reason }).then(() => { toast('ยกเลิกใบสำคัญแล้ว'); setCancelAsk(false); qc.invalidateQueries({ queryKey: ['journal', id] }); qc.invalidateQueries({ queryKey: ['journals'] }); }).catch(toastError)} />}
      {tplPick !== null && (
        <Lookup<Template> title="เลือกต้นแบบวิธีการบันทึก" rows={templates.data ?? []} initial={tplPick}
          cols={[{ key: 'code', label: 'รหัส', w: 120 }, { key: 'name', label: 'รายละเอียด' }, { key: 'line_count', label: 'บรรทัด', w: 70, num: true }]}
          onPick={(t) => pickTemplate(t.id)} onClose={() => setTplPick(null)} onAdd={(t) => { setTplPick(null); setTplAdd(t); }} />
      )}
      {tplAdd !== null && <TemplateForm id={null} initialCode={tplAdd} onClose={() => setTplAdd(null)} onSaved={(tid) => { setTplAdd(null); pickTemplate(tid); }} />}
      {tplReplace && <Confirm title={`ใช้ต้นแบบ ${tplReplace.code}`} text="รายการบัญชีที่ป้อนไว้จะถูกแทนด้วยรายการจากต้นแบบ ต้องการทำต่อหรือไม่?" okText="แทนด้วยต้นแบบ" onClose={() => setTplReplace(null)} onOk={() => applyTemplate(tplReplace)} />}
      {leaveAsk && <Confirm title="ยังไม่ได้บันทึก" text="มีการแก้ไขที่ยังไม่บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?" okText="ออกโดยไม่บันทึก" danger onClose={() => setLeaveAsk(null)} onOk={() => { const to = leaveAsk; setLeaveAsk(null); setDirty(false); nav(to); }} />}
    </div>
  );
}

function CancelDialog({ onClose, onOk }: { onClose: () => void; onOk: (reason: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Modal title="ยืนยันการยกเลิกเอกสาร" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ไม่ใช่</button><button className="danger" disabled={!r.trim()} onClick={() => onOk(r)}>ยกเลิกเอกสาร</button></>}>
      <p>ใบสำคัญที่ยกเลิกจะไม่ถูกนับในยอดบัญชี แต่ยังเก็บไว้ดูย้อนหลังได้ (ไม่ลบทิ้ง)</p>
      <Field label="เหตุผลที่ยกเลิก" req><input autoFocus value={r} onChange={(e) => setR(e.target.value)} /></Field>
    </Modal>
  );
}

export function History({ table, rowId }: { table: string; rowId: string }) {
  const q = useQuery({ queryKey: ['history', table, rowId], queryFn: () => api.get<Array<{ seq: number; occurred_at: string; action: string; display_name: string | null; username: string | null; detail: unknown }>>('/api/v1/activity-log', { table, row_id: rowId }) });
  const ACT: Record<string, string> = { ADD: 'เพิ่ม', EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', DELETE: 'ลบ', RENUMBER: 'เปลี่ยนรหัส' };
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การทำงาน</th><th>รายละเอียด</th></tr></thead>
        <tbody>
          {q.data?.map((r) => <tr key={r.seq}><td className="mono">{new Date(r.occurred_at).toLocaleString('th-TH')}</td><td>{r.display_name ?? r.username}</td><td>{ACT[r.action] ?? r.action}</td><td className="small muted">{r.detail ? JSON.stringify(r.detail).slice(0, 160) : ''}</td></tr>)}
          {!q.data?.length && <tr><td colSpan={4} className="empty">ยังไม่มีประวัติ (รายการที่นำเข้าจาก Express ไม่มีประวัติก่อนนำเข้า)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PrintVoucher({ title, no, date, desc, company, lines, totals }: { title: string; no: string; date: string; desc: string; company: string; lines: Array<{ no: string; name: string; desc: string; dr: string; cr: string }>; totals: { debit: { toFixed: (n: number) => string }; credit: { toFixed: (n: number) => string } } }) {
  return (
    <div className="print-only voucher">
      <h2>{company}</h2><h3>{title}</h3>
      <p>เลขที่ <b>{no}</b> &nbsp; วันที่ <b>{date}</b></p><p>คำอธิบาย {desc}</p>
      <table><thead><tr><th>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th>คำอธิบาย</th><th>เดบิต</th><th>เครดิต</th></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td>{l.no}</td><td>{l.name}</td><td>{l.desc}</td><td className="r">{l.dr ? fmt(l.dr) : ''}</td><td className="r">{l.cr ? fmt(l.cr) : ''}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>รวม</td><td className="r">{fmt(totals.debit.toFixed(2))}</td><td className="r">{fmt(totals.credit.toFixed(2))}</td></tr></tfoot></table>
      <div className="signs"><span>ผู้จัดทำ ____________</span><span>ผู้ตรวจ ____________</span><span>ผู้อนุมัติ ____________</span></div>
    </div>
  );
}

export { Money };
