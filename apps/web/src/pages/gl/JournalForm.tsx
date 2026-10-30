import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { d, fmt, journalTotals, todayIso } from '@buddy/core';
import { api, type Book, type Department, type Template, type TemplateDetail } from '../../api';
import { bookColor, bookStyle } from '../../bookColor';
import { useCan, useSession } from '../../session';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Lookup, Modal, Money, MoneyInput, navKey, Pill, Tabs, toast, toastError, useHotkeys, useYearSystem } from '../../ui';
import { useDocEdit } from '../../components/DocEdit';
import { DocActions } from '../../components/DocPrint';
import { JvChequeTab, JvVatTab, vatPayload, WhtTab, whtPayload, type VatDraft, type WhtDraft } from './JvLinks';
import { TemplateForm, templateToLines, useTemplates } from './Templates';
import { JournalPicker } from '../../components/JournalPicker';

interface Line { key: number; account_id: string | null; department_id: string | null; description: string; debit: string; credit: string }
interface JournalDoc {
  id: string; voucher_no: string; voucher_date: string; description: string | null; reference: string | null; journal_book_id: string; doc_status: string; editable: boolean;
  source_module: string | null; source_doc_no: string | null; source_doc_class: string | null; created_at: string; updated_at: string; created_by_name: string | null;
  lines: Array<{ account_id: string; department_id: string | null; description: string | null; debit: string; credit: string; account_no: string; account_name: string; posting_role: string | null; resolved_from: string | null }>;
}
let seq = 0;
const blank = (): Line => ({ key: ++seq, account_id: null, department_id: null, description: '', debit: '', credit: '' });

/** สมุดรายวัน (JV และเล่มอื่น) — คู่มือบทที่ 15 S-GL-02 */
const TAX_TABS = [['vatP', 'ภาษีซื้อ'], ['vatS', 'ภาษีขาย'], ['wht', 'ภาษีหัก ณ ที่จ่าย'], ['chqP', 'เช็คจ่าย'], ['chqR', 'เช็ครับ']] as const;

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
  const [vatAsk, setVatAsk] = useState(false);
  const ys = useYearSystem();
  /** S-ME-01: เติมรายการปิดภาษีขาย/ภาษีซื้อของเดือน จากยอดคงเหลือในบัญชี ณ สิ้นเดือน */
  const fillVatClosing = async (month: string) => {
    try {
      const r = await api.get<{ date: string; description: string; lines: Array<{ account_id: string | null; description: string; debit: string; credit: string }>; missing: string | null }>('/api/v1/gl/vat-closing', { month });
      if (!r.lines.length) { toast('ไม่มียอดภาษีขาย/ภาษีซื้อคงเหลือ ณ สิ้นเดือนนี้', 'bad'); return; }
      setLines(r.lines.map((l) => ({ key: ++seq, account_id: l.account_id, department_id: null, description: l.description, debit: d(l.debit).isZero() ? '' : l.debit, credit: d(l.credit).isZero() ? '' : l.credit })));
      setH((x) => ({ ...x, voucher_date: r.date, description: `ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน ${month.slice(5)}/${ys === 'B' ? Number(month.slice(0, 4)) + 543 : month.slice(0, 4)}` }));
      setDirty(true); setVatAsk(false);
      if (r.missing) toast(`ยังไม่ได้กำหนดบัญชี${r.missing === 'VAT_PAYABLE' ? 'เจ้าหนี้' : 'ลูกหนี้'}กรมสรรพากร — เลือกบัญชีในบรรทัดสุดท้าย หรือกำหนดที่การเชื่อมต่อบัญชี`, 'bad');
    } catch (e) { toastError(e); }
  };
  const [h, setH] = useState({ journal_book_id: sp.get('book') ?? '', voucher_date: me?.work_date ?? todayIso(), description: '', reference: '' });
  // ค่าเริ่มต้นระบบบัญชี ข้อ 2: ลำดับเลขที่แบบ 0 = ผู้ใช้ป้อนเลขที่ใบสำคัญเอง
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ values: Record<string, unknown> }>('/api/v1/settings'), staleTime: 60_000 });
  const manualNo = isNew && settings.data?.values['gl.voucher_numbering'] === '0';
  const [typedNo, setTypedNo] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState('lines');
  const [cancelAsk, setCancelAsk] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // รายละเอียดภาษีที่ป้อนในแท็บก่อนบันทึกใบสำคัญใหม่ — ส่งไปพร้อมใบสำคัญ (บันทึกในทรานแซกชันเดียวกัน)
  const [drafts, setDrafts] = useState<{ vat: VatDraft[]; wht: WhtDraft[] }>({ vat: [], wht: [] });
  const [taxAsk, setTaxAsk] = useState<{ andNew: boolean; gaps: Array<{ key: string; label: string; line: string; entered: string }> } | null>(null);
  const [nextNo, setNextNo] = useState('');
  // ช่องเลขที่ (ข้อกำหนดเจ้าของ): แสดงตัวนำหน้าของสมุดไว้ให้ คีย์เลขเองได้ · ไม่คีย์ = เลขอัตโนมัติ (ยกเว้นบริษัทตั้ง "ป้อนเลขเอง")
  const noPrefix = (nextNo.match(/^\D*/)?.[0] ?? '');
  const ownNo = typedNo.trim() && typedNo.trim().toUpperCase() !== noPrefix.toUpperCase() ? typedNo.trim() : '';
  const [saves, setSaves] = useState(0); // นับครั้งที่บันทึก — ให้ดึงเลขที่ถัดไปใหม่หลัง "บันทึก+ใหม่"
  const gridRef = useRef<HTMLDivElement>(null);
  const can = useCan('GL.JNL');
  const editBase = (isNew ? can('add') : can('edit')) && (isNew || !!doc.data?.editable);
  // ใบสำคัญที่บันทึกแล้ว: ดูอย่างเดียวจนกด แก้ไข (Alt+E) · Enter ช่องสุดท้าย = ถามบันทึก (ข้อกำหนดเจ้าของ)
  const ed = useDocEdit({ id, allowed: !isNew && editBase, dirty, word: 'ใบสำคัญ', onSave: (n) => void save(!!n), onDiscard: () => { void qc.refetchQueries({ queryKey: ['journal', id] }); setDirty(false); } });
  const editable = editBase && !ed.locked;
  // ต้นแบบวิธีการบันทึก (S-GL-05): เลือกจาก 🔍/F4 ที่ช่องเลขที่ใบสำคัญ หรือขึ้นอัตโนมัติตามต้นแบบของสมุด (S-GL-09)
  const templates = useTemplates();
  const [tplPick, setTplPick] = useState<string | null>(null);
  const [tplAdd, setTplAdd] = useState<string | null>(null);
  // ถามก่อนแทนรายการที่ป้อนไว้ (ใช้ร่วมกับต้นแบบและคัดลอกจากใบสำคัญอื่น)
  const [replaceAsk, setReplaceAsk] = useState<{ title: string; okText: string; apply: () => void } | null>(null);
  const [copyPick, setCopyPick] = useState(false);
  const bookTplId = isNew ? books.data?.find((b) => b.id === h.journal_book_id)?.template_id ?? null : null;
  const bookTpl = useQuery({ enabled: !!bookTplId, queryKey: ['template', bookTplId], queryFn: () => api.get<TemplateDetail>(`/api/v1/gl/templates/${bookTplId}`) });
  const freshLines = (t?: TemplateDetail | null): Line[] => (t?.lines.length ? templateToLines(t).map((l) => ({ ...l, key: ++seq })) : [blank(), blank()]);
  const linesBlank = lines.every((l) => !l.account_id && !l.debit && !l.credit && !l.description);
  const applyTemplate = (t: TemplateDetail) => {
    setLines(freshLines(t)); setDirty(true); setReplaceAsk(null);
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
      if (linesBlank) applyTemplate(t); else setReplaceAsk({ title: `ใช้ต้นแบบ ${t.code}`, okText: 'แทนด้วยต้นแบบ', apply: () => applyTemplate(t) });
    } catch (e) { toastError(e); }
  };
  // คัดลอกรายการจากใบสำคัญอื่น (S-GL-06): เอาบรรทัดบัญชีมาทั้งหมด ผู้ใช้ป้อนวันที่ใหม่แล้วบันทึกเป็นใบใหม่
  const applyCopy = (src: JournalDoc) => {
    setLines(src.lines.map((l) => ({ key: ++seq, account_id: l.account_id, department_id: l.department_id, description: l.description ?? '', debit: d(l.debit).isZero() ? '' : d(l.debit).toFixed(2), credit: d(l.credit).isZero() ? '' : d(l.credit).toFixed(2) })));
    if (!h.description && src.description) setH((x) => ({ ...x, description: src.description ?? '' }));
    setDirty(true); setReplaceAsk(null);
    toast(`คัดลอกรายการจาก ${src.voucher_no} แล้ว — ตรวจวันที่และจำนวนเงินก่อนบันทึก`);
    setTimeout(() => document.querySelector<HTMLInputElement>('.head-grid .date-in input')?.focus(), 0);
  };
  const pickCopy = async (jid: string) => {
    setCopyPick(false);
    try {
      const src = await api.get<JournalDoc>(`/api/v1/gl/journals/${jid}`);
      if (!src.lines.length) { toast(`ใบสำคัญ ${src.voucher_no} ไม่มีรายการบัญชีให้คัดลอก`, 'warn'); return; }
      if (linesBlank) applyCopy(src); else setReplaceAsk({ title: `คัดลอกรายการจาก ${src.voucher_no}`, okText: 'แทนด้วยรายการที่คัดลอก', apply: () => applyCopy(src) });
    } catch (e) { toastError(e); }
  };
  useEffect(() => {
    if (isNew && bookTpl.data && linesBlank) setLines(freshLines(bookTpl.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, bookTpl.data]);

  // สมุดเดียว: เลือกให้เลย · หลายสมุด: ให้ผู้ใช้เลือกจากแถบก่อน (ไม่ตั้งเป็นสมุดทั่วไปเอง)
  useEffect(() => {
    if (isNew && !h.journal_book_id && books.data?.length === 1) setH((x) => ({ ...x, journal_book_id: books.data![0]!.id }));
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

  const save = async (andNew = false, skipTaxCheck = false) => {
    if (!editable || busy) return;
    if (!h.journal_book_id) { setErr(new Error('เลือกสมุดรายวัน (แถบด้านบน) ก่อนบันทึก')); return; }
    // บรรทัดบัญชีภาษีซื้อ/ขาย/หัก ณ ที่จ่ายที่ยังไม่ได้ป้อนรายละเอียด (เลขที่ใบกำกับ ผู้ขาย …) — ถามก่อนบันทึก (ใบสำคัญใหม่)
    if (isNew && !skipTaxCheck) {
      const got = { vatP: drafts.vat.filter((v) => v.kind === 'P').reduce((t, v) => t.plus(d(v.vat_amount || 0)).plus(d(v.nonclaim_vat || 0)), d(0)),
        vatS: drafts.vat.filter((v) => v.kind === 'S').reduce((t, v) => t.plus(d(v.vat_amount || 0)), d(0)), wht: drafts.wht.reduce((t, w) => t.plus(d(w.tax_amount || 0)), d(0)) };
      const gaps = (['vatP', 'vatS', 'wht'] as const).filter((k) => sums[k].gt(0) && got[k].lt(sums[k]))
        .map((k) => ({ key: k, label: TAX_TABS.find(([x]) => x === k)![1], line: sums[k].toFixed(2), entered: got[k].toFixed(2) }));
      if (gaps.length) { setTaxAsk({ andNew, gaps }); return; }
    }
    setErr(null); setBusy(true);
    const body = { ...h, voucher_no: ownNo || (manualNo ? null : undefined), description: h.description || null, reference: h.reference || null, lines: lines.map((l) => ({ account_id: l.account_id, department_id: l.department_id, description: l.description || null, debit: l.debit || '0', credit: l.credit || '0' })),
      ...(isNew ? { vat: drafts.vat.map(vatPayload), wht: drafts.wht.map(whtPayload) } : {}) };
    try {
      const r = isNew ? await api.post<{ id: string; voucher_no: string }>('/api/v1/gl/journals', body) : await api.put<{ id: string; voucher_no: string }>(`/api/v1/gl/journals/${id}`, body);
      toast(`บันทึกใบสำคัญ ${r.voucher_no} แล้ว${isNew && (drafts.vat.length || drafts.wht.length) ? ' พร้อมรายการภาษี' : ''}`); setSaves((n) => n + 1);
      setDirty(false); if (!isNew) ed.lock(); setDrafts({ vat: [], wht: [] }); setTab('lines');
      qc.invalidateQueries({ queryKey: ['journals'] }); qc.invalidateQueries({ queryKey: ['journal', r.id] }); qc.invalidateQueries({ queryKey: ['accounts', 'bal'] });
      if (andNew || isNew) { setLines(andNew ? freshLines(bookTpl.data) : [blank(), blank()]); setH((x) => ({ ...x, description: '', reference: '' })); if (!andNew) nav(`/gl/journals/${r.id}`, { replace: true }); else nav(`/gl/journals/new?book=${h.journal_book_id}`, { replace: true }); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const leave = (to: string) => (dirty && editable ? setLeaveAsk(to) : nav(to));
  useHotkeys({
    F9: () => save(), 'Ctrl+S': () => save(), 'Ctrl+Enter': () => save(true), 'Alt+C': () => !isNew && editBase && can('cancel') && setCancelAsk(true), 'Ctrl+F6': () => isNew && setCopyPick(true),
    'Ctrl+Insert': addLine, 'Alt+N': () => leave('/gl/journals/new'), Escape: () => leave(`/gl/journals${h.journal_book_id ? `?book=${h.journal_book_id}` : ''}`),
  }, [h, lines, editable, editBase, dirty, busy, drafts]);

  const acctOf = (aid: string | null) => accts.data?.find((a) => a.id === aid);
  // บรรทัดบัญชีภาษีซื้อ/ภาษีขาย/เช็คจ่าย/เช็ครับล่วงหน้า → แท็บป้อนรายละเอียด (S-GL-03 / S-GL-04)
  const roles = useQuery({ queryKey: ['default-accounts'], queryFn: () => api.get<Array<{ role: string; account_id: string }>>('/api/v1/gl/default-accounts') });
  const roleSum = (role: string, side: 1 | -1) => { const acc = roles.data?.find((r) => r.role === role)?.account_id; return acc ? lines.filter((l) => l.account_id === acc).reduce((t, l) => t.plus(d(l.debit || 0).minus(d(l.credit || 0)).times(side)), d(0)) : d(0); };
  // แท็บแสดงตลอด (ใบสำคัญใหม่ด้วย) พร้อมยอดบรรทัดบัญชีนั้น — ข้อกำหนดเจ้าของ 30/10/2569
  const sums = { vatP: roleSum('INPUT_VAT', 1), vatS: roleSum('OUTPUT_VAT', -1), wht: roleSum('WHT_PAYABLE', -1), chqP: roleSum('CHEQUE_PAID', -1), chqR: roleSum('CHEQUE_RECEIVED', 1) };
  const tabEditable = isNew ? editable : !!doc.data && doc.data.doc_status === 'N' && doc.data.editable;
  const linkInfo = { id: id ?? null, no: doc.data?.voucher_no ?? '', date: String(h.voucher_date).slice(0, 10) };
  const issueLines = new Set(((err as { issues?: Array<{ line?: number }> })?.issues ?? []).map((i) => i.line).filter((x) => x !== undefined));
  const book = books.data?.find((b) => b.id === h.journal_book_id);
  const j = doc.data;
  return (
    <div className={cx('page', book && 'book-colored')} data-tone="gl" style={bookStyle(bookColor(book))}>
      <div className="doc-title">
        <div>
          <p className="eyebrow">บัญชี › ลงประจำวัน › {book ? `${book.code} ${book.name_th}` : 'สมุดรายวัน'}</p>
          <div className="title-row"><h1 className="mono">{isNew ? (nextNo || 'ใบสำคัญใหม่') : j?.voucher_no}</h1>{book && <span className="book-pill" title="สมุดรายวันของใบสำคัญนี้">{isNew ? 'กำลังบันทึก: ' : ''}{book.prefix} {book.name_th}</span>}</div>
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
          {ed.editButton}
          <button disabled={!editable || busy} onClick={() => save(true)} title="บันทึกแล้วขึ้นใบใหม่ (Ctrl+Enter)">บันทึก+ใหม่</button>
        </div>
        <div className="tb-group">
          <button disabled={isNew || !editBase || !can('cancel')} onClick={() => setCancelAsk(true)} title={can('cancel') ? 'ยกเลิกเอกสาร (Alt+C)' : 'ไม่มีสิทธิ์ยกเลิกเอกสาร'}>ยกเลิกเอกสาร</button>
          <DocActions kind="journal" id={isNew ? undefined : id} menu="GL.JNL" typeId={h.journal_book_id} dirty={dirty} />
        </div>
        <div className="tb-group"><button onClick={() => leave(`/gl/journals${h.journal_book_id ? `?book=${h.journal_book_id}` : ''}`)} title="กลับไปรายการ (Esc)">รายการ <kbd>Esc</kbd></button></div>
      </div>
      {/* สมุดรายวันเป็นแถบ: ใบใหม่เลือกได้ · ใบที่บันทึกแล้วแสดงเฉพาะสมุดของใบนั้น (เปลี่ยนสมุดไม่ได้) */}
      <Tabs active={h.journal_book_id} onChange={(k) => { if (isNew && k !== h.journal_book_id) { setDirty(true); setH({ ...h, journal_book_id: k }); } }}
        tabs={(books.data ?? []).filter((b) => isNew || b.id === h.journal_book_id).map((b) => ({ key: b.id, label: `${b.prefix} ${b.name_th}`, color: bookColor(b) }))} />
      {isNew && !h.journal_book_id && books.data && <p className="notebox">เลือกสมุดรายวันจากแถบด้านบนก่อน — เลขที่ใบสำคัญและต้นแบบรายการตามสมุดที่เลือก</p>}
      {ed.dialog}
      <ErrorBox error={err ?? doc.error} />
      <fieldset disabled={!editable} onKeyDown={(e) => navKey(e, ed.end)}>
        <div className="head-grid">
          <div className="col">
            <Field label="วันที่" req><DateInput value={h.voucher_date} onChange={(v) => { setDirty(true); setH({ ...h, voucher_date: v }); }} autoFocus={isNew} /></Field>
            <Field label="เลขที่ใบสำคัญ" hint={isNew ? `${manualNo ? 'ป้อนเลขเอง (ตามค่าเริ่มต้นระบบบัญชี)' : ownNo ? 'คีย์เลขเอง — ห้ามซ้ำ' : `เว้นไว้ = เลขอัตโนมัติ ${nextNo}`} · 🔍/F4 เลือกต้นแบบ · 📋/Ctrl+F6 คัดลอกจากใบสำคัญอื่น` : undefined}>
              <span className="lk-in">
                {isNew
                  ? <input value={typedNo || noPrefix} maxLength={30} className="mono" placeholder={manualNo ? 'ป้อนเลขที่ใบสำคัญ' : nextNo} aria-required={manualNo} aria-label="เลขที่ใบสำคัญ"
                      onChange={(e) => { setDirty(true); setTypedNo(e.target.value.replace(/\s/g, '')); }}
                      onKeyDown={(e) => {
                        if (e.key === 'F4') { e.preventDefault(); setTplPick(''); }
                        else if (e.key === 'Enter' && !ownNo) {
                          if (manualNo) { e.preventDefault(); e.stopPropagation(); toast('บริษัทตั้งให้ป้อนเลขที่ใบสำคัญเอง — คีย์เลขที่ก่อน', 'bad'); }
                          else toast(`ไม่ได้คีย์เลขที่เอง — ใช้เลขที่อัตโนมัติ ${nextNo} (ออกเลขจริงตอนบันทึก)`, 'warn');
                        }
                      }} />
                  : <input readOnly value={j?.voucher_no ?? ''} className="mono" />}
                {isNew && <button type="button" className="icon-btn" onClick={() => setTplPick('')} title="เลือกต้นแบบวิธีการบันทึก (F4)">🔍</button>}
                {isNew && <button type="button" className="icon-btn" onClick={() => setCopyPick(true)} title="คัดลอกรายการจากใบสำคัญอื่น (Ctrl+F6)">📋</button>}
                {isNew && <button type="button" className="icon-btn" onClick={() => setVatAsk(true)} title="ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน">%</button>}
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
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'รายการบัญชี', badge: lines.filter((l) => l.account_id).length },
          ...TAX_TABS.map(([key, label]) => ({ key, label, badge: sums[key].isZero() ? undefined : fmt(sums[key].abs().toFixed(2)) })), ...(!isNew ? [{ key: 'history', label: 'ประวัติการแก้ไข' }] : [])]} />
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
                      <td><AccountCell required value={l.account_id} invalid={issueLines.has(i) && !l.account_id} onChange={(acc) => setLine(l.key, { account_id: acc?.id ?? null, department_id: acc?.use_department ? l.department_id : l.department_id })} /></td>
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
      {(isNew || doc.data) && (tab === 'vatP' || tab === 'vatS') && <JvVatTab key={tab} kind={tab === 'vatP' ? 'P' : 'S'} journal={linkInfo} lineVat={sums[tab].toFixed(2)} editable={tabEditable}
        drafts={drafts.vat} onDrafts={(v) => { setDrafts((x) => ({ ...x, vat: v })); setDirty(true); }} />}
      {(isNew || doc.data) && tab === 'wht' && <WhtTab field="journal_id" link={linkInfo} lineTax={sums.wht.toFixed(2)} editable={tabEditable} drafts={drafts.wht} onDrafts={(w) => { setDrafts((x) => ({ ...x, wht: w })); setDirty(true); }} />}
      {(isNew || doc.data) && (tab === 'chqP' || tab === 'chqR') && <JvChequeTab key={tab} direction={tab === 'chqP' ? 'P' : 'R'} journal={{ id: linkInfo.id, voucher_no: linkInfo.no, date: linkInfo.date }} lineAmount={sums[tab].toFixed(2)} editable={tabEditable} />}
      {taxAsk && <Modal size="confirm" title="ยังไม่ได้ป้อนรายละเอียดภาษี" onClose={() => setTaxAsk(null)}
        footer={<><button onClick={() => setTaxAsk(null)}>กลับไปแก้ <kbd>Esc</kbd></button><button onClick={() => { const a = taxAsk.andNew; setTaxAsk(null); void save(a, true); }}>บันทึกโดยไม่ป้อน</button>
          <button className="primary" autoFocus onClick={() => { setTab(taxAsk.gaps[0]!.key); setTaxAsk(null); }}>ป้อนรายละเอียด</button></>}>
        {taxAsk.gaps.map((g) => <p key={g.key}>บรรทัดบัญชี<b>{g.label}</b> {fmt(g.line)} — ป้อนรายละเอียดแล้ว {fmt(g.entered)}</p>)}
        <p className="small muted">รายละเอียด (เลขที่ใบกำกับ/หนังสือรับรอง ชื่อและเลขผู้เสียภาษีของคู่ค้า) ใช้ทำรายงานภาษีซื้อ-ขาย และแบบ ภ.ง.ด. — ป้อนภายหลังได้ที่แท็บนี้หรือที่แฟ้มภาษี</p>
      </Modal>}
      {j && <p className="hint">สร้างโดย {j.created_by_name ?? 'นำเข้าจาก Express'} · <DateText v={j.created_at.slice(0, 10)} /> · แก้ไขล่าสุด <DateText v={j.updated_at.slice(0, 10)} /></p>}
      {vatAsk && <VatClosingModal workDate={h.voucher_date} onClose={() => setVatAsk(false)} onOk={fillVatClosing} />}
      <KeyHints keys={[['Enter', 'ช่องถัดไป (ช่องสุดท้าย = ถามบันทึก)'], ['Alt+E', 'แก้ไขเอกสารที่บันทึกแล้ว'], ['F4', 'ค้นหาบัญชี / ต้นแบบ (ที่ช่องเลขที่)'], ['Ctrl+F6', 'คัดลอกจากใบสำคัญอื่น'],['F9', 'บันทึก'], ['Ctrl+Enter', 'บันทึก+ใหม่'], ['Ctrl+Ins', 'เพิ่มบรรทัด'], ['Alt+C', 'ยกเลิกเอกสาร'], ['Alt+P', 'พิมพ์'], ['Esc', 'กลับรายการ']]} />
      {cancelAsk && <CancelDialog onClose={() => setCancelAsk(false)} onOk={(reason) => api.post(`/api/v1/gl/journals/${id}/cancel`, { reason }).then(() => { toast('ยกเลิกใบสำคัญแล้ว'); setCancelAsk(false); qc.invalidateQueries({ queryKey: ['journal', id] }); qc.invalidateQueries({ queryKey: ['journals'] }); }).catch(toastError)} />}
      {tplPick !== null && (
        <Lookup<Template> title="เลือกต้นแบบวิธีการบันทึก" rows={templates.data ?? []} initial={tplPick}
          cols={[{ key: 'code', label: 'รหัส', w: 120 }, { key: 'name', label: 'รายละเอียด' }, { key: 'line_count', label: 'บรรทัด', w: 70, num: true }]}
          onPick={(t) => pickTemplate(t.id)} onClose={() => setTplPick(null)} onAdd={(t) => { setTplPick(null); setTplAdd(t); }} />
      )}
      {tplAdd !== null && <TemplateForm id={null} initialCode={tplAdd} onClose={() => setTplAdd(null)} onSaved={(tid) => { setTplAdd(null); pickTemplate(tid); }} />}
      {copyPick && <JournalPicker onClose={() => setCopyPick(false)} onPick={pickCopy} />}
      {replaceAsk && <Confirm title={replaceAsk.title} text="รายการบัญชีที่ป้อนไว้จะถูกแทนที่ทั้งหมด ต้องการทำต่อหรือไม่?" okText={replaceAsk.okText} onClose={() => setReplaceAsk(null)} onOk={replaceAsk.apply} />}
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

export { Money };

/** เลือกเดือนที่จะปรับปรุงภาษีมูลค่าเพิ่ม */
function VatClosingModal({ workDate, onClose, onOk }: { workDate: string; onClose: () => void; onOk: (month: string) => void }) {
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const ys = useYearSystem();
  const y0 = Number(workDate.slice(0, 4));
  const [y, setY] = useState(y0);
  const [m, setM] = useState(Number(workDate.slice(5, 7)));
  return (
    <Modal title="ปรับปรุงภาษีมูลค่าเพิ่มประจำเดือน" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" autoFocus onClick={() => onOk(`${y}-${String(m).padStart(2, '0')}`)}>เติมรายการ</button></>}>
      <p>เติมรายการ Dr ภาษีขาย / Cr ภาษีซื้อ / ผลต่างเข้าเจ้าหนี้ (หรือลูกหนี้) กรมสรรพากร จากยอดคงเหลือ ณ สิ้นเดือน — ตรวจแล้วกดบันทึก (คู่มือหน้า 315)</p>
      <div className="form-grid">
        <Field label="เดือน"><select value={m} onChange={(e) => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></Field>
        <Field label="ปี"><select value={y} onChange={(e) => setY(Number(e.target.value))}>{[y0 - 2, y0 - 1, y0, y0 + 1].map((v) => <option key={v} value={v}>{ys === 'B' ? v + 543 : v}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
