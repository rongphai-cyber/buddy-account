import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fmt, formatDate, PRINT_HEAD_FIELDS, type PrintFamily, type PrintFormEntry, type YearSystem } from '@buddy/core';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { DateInput, ErrorBox, Field, Modal, Pill, toast, toastError, useHotkeys, useYearSystem } from '../ui';
import { DocNotesDialog } from './Notes';

export interface PrintData {
  kind: 'doc' | 'journal'; scope: string; family: PrintFamily; title: string; title_en: string; doc_no: string; doc_date: string; cancelled: boolean;
  company: { name: string; name_en: string; address: string; phone: string; tax_id: string; branch: string };
  party: { code: string; name: string; address: string; phone: string; tax_id: string; branch: string } | null;
  fields: Record<string, string>; lines: Array<Record<string, string>>; totals: Array<{ label: string; value: string; value2?: string }>;
  amount_text: string; payments: Array<{ method: string; ref: string; date: string; amount: string }>; notes: string[];
  journal: Array<Record<string, string>>; print_count: number; approved: boolean;
}
type PrintResp = { data: PrintData; forms: PrintFormEntry[]; rule: { approveLevel: number; method: string | null; reprintLevel: number }; block: string | null };

const MONEY_KEYS = new Set(['price', 'amount', 'ref_amount', 'debit', 'credit']);
const DATE_KEYS = new Set(['ref_date', 'due_date', 'date']);
const DATE_FIELDS = new Set(['due_date', 'delivery_date', 'appointment_date']);
const cellText = (key: string, v: string | undefined, ys: YearSystem) => (!v ? '' : MONEY_KEYS.has(key) ? fmt(v) : DATE_KEYS.has(key) ? formatDate(v, ys) : v);

/** แผ่นเอกสารตามแบบฟอร์ม — ใช้ทั้งดูทางจอภาพและพิมพ์ (หนึ่งแผ่นต่อสำเนา) */
export function PrintSheet({ data, form, ys }: { data: PrintData; form: PrintFormEntry; ys: YearSystem }) {
  const L = form.layout;
  const cols = L.columns.filter((c) => c.show);
  const totalW = cols.reduce((s, c) => s + c.width, 0) || 1;
  const copies = L.copies.length ? L.copies : [''];
  const fill = Math.max(0, L.min_rows - data.lines.length);
  const heads = L.head_fields.map((k) => ({ k, label: PRINT_HEAD_FIELDS.find((f) => f.key === k)?.label ?? k, v: data.fields[k] ?? '' })).filter((x) => x.v);
  const isJ = data.family === 'journal';
  return (
    <>
      {copies.map((cp, ci) => (
        <div key={ci} className={`doc-sheet b-${form.base}`} style={{ fontSize: `${L.font_pt}pt` }}>
          <header className="ds-head">
            {L.show_company && <div className="ds-co"><b>{data.company.name}</b>{data.company.name_en && <div>{data.company.name_en}</div>}
              <div>{data.company.address}</div>
              <div>{[data.company.phone && `โทร ${data.company.phone}`, data.company.tax_id && `เลขประจำตัวผู้เสียภาษี ${data.company.tax_id}`, data.company.branch].filter(Boolean).join('  ')}</div></div>}
            <div className="ds-title"><h1>{L.title || data.title}</h1>{L.title_en && <div className="ds-en">{L.title_en}</div>}
              {cp && <div className="ds-copy">{cp}</div>}{data.cancelled && <div className="ds-void">ยกเลิก</div>}</div>
          </header>
          <div className="ds-info">
            {L.show_party && data.party ? <div className="ds-party">
              <div><b>{data.party.name}</b>{data.party.code && <span className="ds-muted"> ({data.party.code})</span>}</div>
              {data.party.address && <div>{data.party.address}</div>}
              {(data.party.tax_id || data.party.branch) && <div>{data.party.tax_id && `เลขประจำตัวผู้เสียภาษี ${data.party.tax_id}`} {data.party.branch}</div>}
              {data.party.phone && <div>โทร {data.party.phone}</div>}
            </div> : <div />}
            <table className="ds-meta"><tbody>
              <tr><th>เลขที่</th><td>{data.doc_no}</td></tr>
              <tr><th>วันที่</th><td>{formatDate(data.doc_date, ys)}</td></tr>
              {heads.map((h) => <tr key={h.k}><th>{h.label}</th><td>{DATE_FIELDS.has(h.k) ? formatDate(h.v, ys) : h.v}</td></tr>)}
            </tbody></table>
          </div>
          <table className="ds-lines">
            <colgroup>{cols.map((c) => <col key={c.key} style={{ width: `${(c.width / totalW) * 100}%` }} />)}</colgroup>
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.align}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data.lines.map((l, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.align}>{cellText(c.key, l[c.key], ys)}</td>)}</tr>)}
              {[...Array(fill).keys()].map((i) => <tr key={`f${i}`} className="ds-fill">{cols.map((c) => <td key={c.key}>&nbsp;</td>)}</tr>)}
            </tbody>
            {isJ && data.totals[0] && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={c.align}>{c.key === 'debit' ? fmt(data.totals[0]!.value) : c.key === 'credit' ? fmt(data.totals[0]!.value2 ?? '') : i === 0 ? 'รวม' : ''}</td>)}</tr></tfoot>}
          </table>
          <div className="ds-sum">
            <div className="ds-left">
              {L.show_amount_text && data.amount_text && <div className="ds-baht">({data.amount_text})</div>}
              {L.show_payments && data.payments.length > 0 && <table className="ds-pay"><tbody>{data.payments.map((p, i) => <tr key={i}><td>{p.method}</td><td>{p.ref}</td><td>{formatDate(p.date, ys)}</td><td className="r">{fmt(p.amount)}</td></tr>)}</tbody></table>}
              {L.show_notes && (data.notes.length > 0 || (data.fields.remark && !L.head_fields.includes('remark'))) && <div className="ds-notes">หมายเหตุ: {[data.fields.remark, ...data.notes].filter(Boolean).join(' · ')}</div>}
            </div>
            {L.show_totals && !isJ && <table className="ds-totals"><tbody>{data.totals.map((t, i) => <tr key={i} className={i === data.totals.length - 1 ? 'ds-net' : ''}><th>{t.label}</th><td className="r">{fmt(t.value)}</td></tr>)}</tbody></table>}
          </div>
          {L.show_journal && !isJ && data.journal.length > 0 && <table className="ds-jnl"><thead><tr><th>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r">เดบิต</th><th className="r">เครดิต</th></tr></thead>
            <tbody>{data.journal.map((j, i) => <tr key={i}><td>{j.code}</td><td>{j.name}</td><td className="r">{j.debit && fmt(j.debit)}</td><td className="r">{j.credit && fmt(j.credit)}</td></tr>)}</tbody></table>}
          {L.signatures.length > 0 && <div className="ds-sign">{L.signatures.map((s, i) => <div key={i}><div className="ds-line" /><div>{s}</div><div className="ds-muted">วันที่ ......../......../........</div></div>)}</div>}
          {L.footer && <div className="ds-footer">{L.footer}</div>}
        </div>
      ))}
    </>
  );
}

/**
 * ปุ่มพิมพ์/รับรอง/ข้อมูลเอกสาร บนแถบเครื่องมือของหน้าจอเอกสาร (S-RD-01 · S-UI-08..12 · S-RD-06)
 * Alt+P พิมพ์ฟอร์ม 1 · Shift+Alt+P เลือกแบบฟอร์ม · Alt+O รับรอง · Ctrl+O ยกเลิกรับรอง · Alt+Shift+O รับรองเป็นช่วง · Ctrl+I รายละเอียดแฟ้มข้อมูล
 */
export function DocActions({ kind, id: rawId, menu, typeId }: { kind: 'doc' | 'journal'; id: string | null | undefined; menu: string; typeId?: string | null }) {
  const id = rawId ?? undefined;
  const qc = useQueryClient();
  const nav = useNavigate();
  const ys = useYearSystem();
  const can = useCan(menu);
  const canForm = useCan('RP.FORM');
  const { me } = useSession();
  const q = useQuery({ enabled: !!id, queryKey: ['print', kind, id], queryFn: () => api.get<PrintResp>(`/api/v1/print/${kind}/${id}`), staleTime: 0 });
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PrintFormEntry | null>(null);
  const [printing, setPrinting] = useState<PrintFormEntry | null>(null);
  const [info, setInfo] = useState(false);
  const [range, setRange] = useState(false);
  const [notes, setNotes] = useState(false);
  const r = q.data;
  const approved = !!r?.data.approved;
  const screenOnly = me?.perms?.[menu]?.print === 'S';

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(null); }, 80);
    return () => clearTimeout(t);
  }, [printing]);
  useEffect(() => { if (!open) return; const close = () => setOpen(false); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [open]);

  const doPrint = async (slot: number) => {
    setOpen(false);
    if (!id || !r) return;
    const f = r.forms.find((x) => x.slot === slot);
    if (!f) return toast(`ไม่มีแบบฟอร์มหมายเลข ${slot} — เลือกจากเมนูพิมพ์ ▾`, 'warn');
    if (screenOnly) { setPreview(f); return toast('สิทธิ์ของคุณพิมพ์ได้เฉพาะแสดงทางจอภาพ', 'warn'); }
    try {
      await api.post(`/api/v1/print/${kind}/${id}/printed`, { slot });
      setPreview(null); setPrinting(f);
      qc.invalidateQueries({ queryKey: ['print', kind, id] });
    } catch (e) { toastError(e); }
  };
  const approve = async (undo: boolean) => {
    if (!id) return;
    try {
      await api.post(`/api/v1/approve/${kind}/${id}`, { undo });
      toast(undo ? 'ยกเลิกการรับรองแล้ว' : 'รับรองเอกสารแล้ว');
      qc.invalidateQueries({ queryKey: ['print', kind, id] });
    } catch (e) { toastError(e); }
  };
  useHotkeys({
    'Alt+P': id && can('print') ? () => doPrint(1) : undefined,
    'Alt+Shift+P': id && can('print') ? () => setOpen(true) : undefined,
    'Alt+O': id && can('approve') && !approved ? () => approve(false) : undefined,
    'Ctrl+O': id && can('approve') && approved ? () => approve(true) : undefined,
    'Alt+Shift+O': can('approve') ? () => setRange(true) : undefined,
    'Ctrl+I': id ? () => setInfo(true) : undefined,
    'Alt+R': id && kind === 'doc' ? () => setNotes(true) : undefined,
  });

  return (
    <>
      <span className="split-btn" onClick={(e) => e.stopPropagation()}>
        <button disabled={!id || !r || !can('print')} onClick={() => doPrint(1)} title={r?.block ?? 'พิมพ์แบบฟอร์ม 1 (Alt+P)'}>🖨 พิมพ์ <kbd>Alt+P</kbd></button>
        <button className="caret" disabled={!id || !r || !can('print')} onClick={() => setOpen((x) => !x)} title="เลือกแบบฟอร์ม (Shift+Alt+P)" aria-haspopup="menu" aria-expanded={open}>▾</button>
        {open && r && <ul className="pop-menu" role="menu">
          {r.forms.map((f) => <li key={f.slot} role="none"><button role="menuitem" onClick={() => doPrint(f.slot)}><b>{f.slot}</b> {f.name}{f.custom && <span className="muted small"> (ของบริษัท)</span>}</button>
            <button className="icon-btn" title="ดูทางจอภาพ (ไม่นับครั้งที่พิมพ์)" onClick={() => { setOpen(false); setPreview(f); }}>👁</button></li>)}
          {canForm('edit') && <li role="none"><button role="menuitem" onClick={() => nav(`/settings/print-forms?scope=${r.data.scope}`)}>✎ แก้ไขแบบฟอร์ม…</button></li>}
        </ul>}
      </span>
      {id && r && (approved ? <button disabled={!can('approve')} onClick={() => approve(true)} title="ยกเลิกการรับรอง (Ctrl+O)">✔ รับรองแล้ว · ยกเลิก</button>
        : r.rule.approveLevel > 0 && <button disabled={!can('approve')} onClick={() => approve(false)} title={`รับรองเอกสาร — ต้องระดับ ${r.rule.approveLevel} ขึ้นไป (Alt+O)`}>✔ รับรอง <kbd>Alt+O</kbd></button>)}
      {kind === 'doc' && id && r && ['QT', 'DP', 'VR'].includes(r.data.scope) && <StatusCodeSelect id={id} canEdit={can('edit')} />}
      {kind === 'doc' && <button disabled={!id} onClick={() => setNotes(true)} title={id ? 'หมายเหตุเพิ่มเติม (Alt+R)' : 'บันทึกเอกสารก่อนจึงเพิ่มหมายเหตุได้'}>📝 หมายเหตุ</button>}
      <button disabled={!id} onClick={() => setInfo(true)} title="รายละเอียดแฟ้มข้อมูล (Ctrl+I)">ℹ</button>
      {r && r.data.print_count > 0 && <Pill tone="n">พิมพ์แล้ว {r.data.print_count} ครั้ง</Pill>}
      {preview && r && <Modal title={`ดูทางจอภาพ — ${preview.slot}. ${preview.name}`} size="wide" onClose={() => setPreview(null)}
        footer={<><button onClick={() => setPreview(null)}>ปิด</button>{!screenOnly && <button className="primary" disabled={!can('print')} onClick={() => doPrint(preview.slot)}>🖨 พิมพ์</button>}</>}>
        {r.block && <p className="err-msg">{r.block}</p>}
        <div className="ds-preview"><PrintSheet data={r.data} form={preview} ys={ys} /></div>
      </Modal>}
      {printing && r && createPortal(<div className="doc-print"><PrintSheet data={r.data} form={printing} ys={ys} /></div>, document.body)}
      {info && id && <RecordInfo kind={kind} id={id} onClose={() => setInfo(false)} />}
      {notes && id && <DocNotesDialog id={id} canEdit={can('edit')} onClose={() => setNotes(false)} />}
      {range && <ApproveRange kind={kind} scope={r?.data.scope} typeId={typeId ?? null} onClose={() => setRange(false)} onDone={() => qc.invalidateQueries({ queryKey: ['print'] })} />}
    </>
  );
}

type Info = { table: string; table_th: string; doc_no: string; type: string; id: string; line_count: number; created_at: string; created_by: string; updated_at: string; updated_by: string; row_version: string;
  print_count: number; last_printed_at: string | null; last_printed_by: string; approved_at: string | null; approved_by: string; status: string; gl_posted: string | null;
  rule: { approveLevel: number; method: string | null; reprintLevel: number }; position: { index: number; total: number }; log: Array<{ at: string; action: string; user: string }> };
const ts = (v: string | null | undefined, ys: YearSystem) => (v ? `${formatDate(v.slice(0, 10), ys)} ${new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : '—');
const ACT_TH: Record<string, string> = { ADD: 'เพิ่ม', EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', PRINT: 'พิมพ์', REPRINT: 'พิมพ์ซ้ำ', APPROVE: 'รับรอง', UNAPPROVE: 'ยกเลิกรับรอง', DELETE: 'ลบ' };

/** รายละเอียดแฟ้มข้อมูล (S-RD-06) — Express กด Tab บนหน้าจอเอกสาร · Buddy ใช้ปุ่ม ℹ หรือ Ctrl+I */
function RecordInfo({ kind, id, onClose }: { kind: 'doc' | 'journal'; id: string; onClose: () => void }) {
  const ys = useYearSystem();
  const q = useQuery({ queryKey: ['record-info', kind, id], queryFn: () => api.get<Info>(`/api/v1/record-info/${kind}/${id}`), staleTime: 0 });
  const x = q.data;
  const method = x?.rule.method === '1' ? 'พิมพ์ก่อนรับรอง' : x?.rule.method === '2' ? 'รับรองก่อนพิมพ์' : '—';
  return (
    <Modal title="รายละเอียดแฟ้มข้อมูล" onClose={onClose} footer={<button className="primary" onClick={onClose}>ปิด <kbd>Esc</kbd></button>}>
      <ErrorBox error={q.error} />
      {x && <table className="grid info-table"><tbody>
        <tr><th>แฟ้มข้อมูล</th><td>{x.table_th}</td></tr>
        <tr><th>ประเภท / เลขที่</th><td>{x.type} · <b className="mono">{x.doc_no}</b></td></tr>
        <tr><th>ลำดับระเบียน</th><td>{x.position.index.toLocaleString()} / {x.position.total.toLocaleString()} (เรียงตามเลขที่) · {x.line_count} บรรทัด</td></tr>
        <tr><th>สร้างโดย</th><td>{x.created_by || '—'} · {ts(x.created_at, ys)}</td></tr>
        <tr><th>แก้ไขล่าสุดโดย</th><td>{x.updated_by || '—'} · {ts(x.updated_at, ys)} · ครั้งที่ {x.row_version}</td></tr>
        <tr><th>พิมพ์</th><td>{x.print_count} ครั้ง{x.last_printed_at && ` · ล่าสุด ${x.last_printed_by} ${ts(x.last_printed_at, ys)}`}</td></tr>
        <tr><th>รับรองเอกสาร</th><td>{x.approved_at ? `${x.approved_by} · ${ts(x.approved_at, ys)}` : 'ยังไม่รับรอง'} — ต้องระดับ {x.rule.approveLevel || 'ไม่ต้องรับรอง'} · {method} · พิมพ์ซ้ำระดับ {x.rule.reprintLevel || '—'}</td></tr>
        <tr><th>สถานะ</th><td>{x.status === 'C' ? 'ยกเลิก' : 'ปกติ'}{x.gl_posted && ` · ลงบัญชี ${x.gl_posted === 'Y' ? 'แล้ว' : 'ยังไม่ลง'}`}</td></tr>
        <tr><th>รหัสระเบียน</th><td className="mono small">{x.id}</td></tr>
      </tbody></table>}
      {x && x.log.length > 0 && <><h3 className="small">ประวัติการทำรายการ</h3><table className="grid"><tbody>{x.log.map((l, i) => <tr key={i}><td>{ts(l.at, ys)}</td><td>{ACT_TH[l.action] ?? l.action}</td><td>{l.user}</td></tr>)}</tbody></table></>}
    </Modal>
  );
}

/** กำหนดช่วงเพื่อรับรองเอกสาร (S-UI-12) */
function ApproveRange({ kind, scope, typeId, onClose, onDone }: { kind: 'doc' | 'journal'; scope?: string; typeId: string | null; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const types = useQuery({ queryKey: ['approve-types', kind, scope], queryFn: async () => kind === 'journal'
    ? (await api.get<Array<{ id: string; code: string; name_th: string; approve_level?: number }>>('/api/v1/gl/books')).map((b) => ({ id: b.id, label: `${b.code} ${b.name_th}`, level: b.approve_level ?? 0 }))
    : (await api.get<Array<{ id: string; code: string; doc_class: string; name_th: string; approve_level: number | null }>>('/api/v1/doc-types')).filter((t) => !scope || t.doc_class === scope).map((t) => ({ id: t.id, label: `${t.code} ${t.name_th}`, level: t.approve_level ?? 0 })) });
  const [f, setF] = useState({ type_id: typeId ?? '', from_no: '', to_no: '', from_date: me?.work_date ?? '', to_date: me?.work_date ?? '' });
  const [res, setRes] = useState<{ approved: number; not_approved: number; skipped: Array<{ doc_no: string; reason: string }> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f.type_id && types.data?.[0]) setF((x) => ({ ...x, type_id: types.data![0]!.id })); }, [types.data, f.type_id]);
  const run = async () => {
    setErr(null); setBusy(true);
    try { setRes(await api.post('/api/v1/approve-range', { kind, ...f })); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: run });
  const sel = types.data?.find((t) => t.id === f.type_id);
  return (
    <Modal title="รับรองเอกสารเป็นช่วง" onClose={onClose} footer={<><button onClick={onClose}>ปิด</button><button className="primary" disabled={busy || !f.type_id} onClick={run}>รับรอง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label={kind === 'journal' ? 'สมุดรายวัน' : 'ประเภทเอกสาร'} wide hint={sel ? (sel.level ? `ต้องระดับอนุมัติ ${sel.level} ขึ้นไป` : 'ประเภทนี้ไม่ต้องรับรอง') : undefined}>
          <select value={f.type_id} onChange={(e) => setF({ ...f, type_id: e.target.value })}>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="เลขที่เอกสารจาก" hint="ว่าง = ตั้งแต่ต้น"><input className="mono" value={f.from_no} onChange={(e) => setF({ ...f, from_no: e.target.value.toUpperCase() })} /></Field>
        <Field label="ถึง" hint="ว่าง = ถึงท้ายสุด"><input className="mono" value={f.to_no} onChange={(e) => setF({ ...f, to_no: e.target.value.toUpperCase() })} /></Field>
        <Field label="วันที่จาก" req><DateInput value={f.from_date} onChange={(v) => setF({ ...f, from_date: v })} /></Field>
        <Field label="ถึง" req><DateInput value={f.to_date} onChange={(v) => setF({ ...f, to_date: v })} /></Field>
      </div>
      {res && <div className="note-box"><p>รับรองแล้ว <b>{res.approved.toLocaleString()}</b> ใบ · ไม่รับรอง <b>{res.not_approved.toLocaleString()}</b> ใบ</p>
        {res.skipped.length > 0 && <ul className="small">{res.skipped.slice(0, 20).map((s) => <li key={s.doc_no}><span className="mono">{s.doc_no}</span> — {s.reason}</li>)}</ul>}</div>}
    </Modal>
  );
}

/** สถานะเอกสารตามตารางข้อมูล (ใบเสนอราคา ตาราง 44 · เงินสดย่อย ตาราง 53) — เปลี่ยนแล้วบันทึกทันที */
function StatusCodeSelect({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['doc-status', id], queryFn: () => api.get<{ table: string | null; status_code: string | null; options: Array<{ code: string; name_th: string }> }>(`/api/v1/doc-status/doc/${id}`), staleTime: 0 });
  if (!q.data?.table) return null;
  return (
    <label className="small">สถานะ <select value={q.data.status_code ?? ''} disabled={!canEdit} title={`ตารางข้อมูล ${q.data.table}`} onChange={async (e) => {
      try { await api.put(`/api/v1/doc-status/doc/${id}`, { status_code: e.target.value || null }); toast('เปลี่ยนสถานะแล้ว'); qc.invalidateQueries({ queryKey: ['doc-status', id] }); } catch (err) { toastError(err); }
    }}><option value="">—</option>{q.data.options.map((o) => <option key={o.code} value={o.code}>{o.code} {o.name_th}</option>)}</select></label>
  );
}
