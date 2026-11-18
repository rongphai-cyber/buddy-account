import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { JOURNAL_IMPORT_COLUMNS, JOURNAL_IMPORT_NEED_LABEL, journalImportHeader, type JournalImportNeed } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, DateText, ErrorBox, KeyHints, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { download, readBase64 } from '../tools/TradeImport';

type Action = 'skip' | 'overwrite' | 'new';
type CLine = { account: string; description: string; department: string; job: string; debit: string; credit: string };
type CTax = { kind: string; no: string; date: string; base: string; amount: string };
type Side = { voucher_no: string | null; book: string; date: string; ref: string; description: string; debit: string; lines: CLine[]; taxes: CTax[] };
type Match = { by: 'voucher_no' | 'ref'; voucher_no: string; doc_status: string; can_overwrite: boolean; why_not: string | null; file: Side; current: Side; diffs: string[] };
type Status = 'ok' | 'dup' | 'error' | 'created' | 'overwritten' | 'skipped';
type VRow = { key: string; group: string; book: string; row: number; date: string; ref: string | null; description: string | null; lines: number; debit: string; credit: string; diff: string;
  voucher_no: string | null; taxes: number; status: Status; action: Action | null; match: Match | null };
type Result = { ok: boolean; committed: boolean; vouchers: VRow[]; errors: Array<{ row: number; message: string }>; file_vouchers: number;
  total_debit: string; total_credit: string; total_diff: string; import_count: number; import_debit: string; dup_count: number; has_tax: boolean };

const ACTION_LABEL: Record<Action, string> = { skip: 'ไม่นำเข้า', overwrite: 'ทับเอกสารเดิม', new: 'สร้างเป็นเอกสารใหม่' };
const STATUS: Record<Status, [string, 'n' | 'm' | 'c' | 'd' | 'x']> = {
  ok: ['ใบใหม่', 'n'], dup: ['ซ้ำ', 'd'], error: ['ต้องแก้', 'c'], created: ['นำเข้าแล้ว', 'm'], overwritten: ['ทับแล้ว', 'm'], skipped: ['ไม่นำเข้า', 'x'],
};
const TAX_LABEL: Record<string, string> = { P: 'ภาษีซื้อ', S: 'ภาษีขาย', S03: 'ภ.ง.ด.3', S53: 'ภ.ง.ด.53' };
const NEED_GROUPS: Array<[string, JournalImportNeed[]]> = [['req', ['required', 'grouping', 'either']], ['cond', ['tax']], ['', ['optional']]];

/**
 * นำเข้าใบสำคัญจาก Excel (เจ้าของ 17/11/2569 ขั้นที่ 1) — สมุดรายวันทุกเล่ม
 * ดาวน์โหลดแบบฟอร์ม → เลือกแฟ้ม (ระบบตรวจทันที ยังไม่บันทึก) → นำเข้า (ลงบัญชีทุกใบพร้อมกัน ผิดใบเดียวไม่บันทึกเลย)
 * 18/11/2569: ใบที่เลขที่/อ้างอิงซ้ำกับใบที่มีอยู่ ไม่นำเข้าเอง — แสดงเปรียบเทียบ ให้เลือก ทับเอกสารเดิม / สร้างเป็นเอกสารใหม่ / ไม่นำเข้า (ค่าเริ่มต้น)
 */
export function JournalImportPage() {
  const can = useCan('GL.JNL');
  const nav = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [acts, setActs] = useState<Record<string, Action>>({});
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const run = async (commit: boolean, f = file, a = acts) => {
    if (!f || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>('/api/v1/gl/journal-import', { file_name: f.name, data: f.data, commit, actions: a });
      setRes(r);
      if (commit) { toast(`นำเข้าใบสำคัญ ${r.import_count} ใบแล้ว`); qc.invalidateQueries({ queryKey: ['journals'] }); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setRes(null); setErr(null); setActs({});
    try { const v = { name: f.name, data: await readBase64(f) }; setFile(v); await run(false, v, {}); } catch (e) { setErr(e); }
  };
  /** เปลี่ยนการเลือกของใบซ้ำ → ตรวจแฟ้มใหม่ทันที (ระบบตรวจการเลือกซ้ำอีกครั้งตอนนำเข้า) */
  const choose = (next: Record<string, Action>) => { setActs(next); void run(false, file, next); };
  const dups = (res?.vouchers ?? []).filter((x) => x.match);
  const chooseAll = (a: Action) => choose(Object.fromEntries(dups.map((x) => [x.key, a === 'overwrite' && !x.match!.can_overwrite ? 'skip' : a])));
  const ready = !!res && !res.committed && res.ok && res.import_count > 0;
  const taxCount = (res?.vouchers ?? []).filter((x) => x.status !== 'error' && (x.status !== 'dup' || x.action !== 'skip')).reduce((n, x) => n + (x.taxes ?? 0), 0);
  const taxNote = taxCount ? ` พร้อมรายการภาษี ${taxCount} รายการ` : '';
  const overN = res ? res.vouchers.filter((x) => x.status === 'dup' && x.action === 'overwrite').length : 0;
  const overNote = overN ? ` (ทับเอกสารเดิม ${overN} ใบ)` : '';
  const skipN = res ? res.vouchers.filter((x) => x.status === 'dup' && x.action === 'skip').length : 0;
  const unbalanced = !!res && !res.committed && res.total_diff !== '0.00';
  useHotkeys({ F9: can('add') && ready ? () => setAsk(true) : undefined, Escape: () => nav('/gl/journals') }, [ready]);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ลงประจำวัน › นำเข้า Excel" title="นำเข้าใบสำคัญจากแฟ้ม Excel"
        lead={<>หนึ่งแถวในแฟ้ม = หนึ่งบรรทัดบัญชี · แถวที่ <b>สมุด</b> และ <b>เลขที่กลุ่ม</b> เดียวกันรวมเป็นใบสำคัญใบเดียว · เลือกแฟ้มแล้วระบบ<b>ตรวจก่อน</b> (ยังไม่บันทึก): เดบิต = เครดิตทุกใบ บัญชี แผนก Job มีจริง งวดยังเปิด · <b>ใบที่เลขที่หรืออ้างอิงซ้ำ</b>กับใบที่มีอยู่ไม่นำเข้าเอง — ดูเปรียบเทียบแล้วเลือก ทับเอกสารเดิม / สร้างเป็นเอกสารใหม่ / ไม่นำเข้า · กดนำเข้าแล้วลงบัญชีทุกใบพร้อมกัน — ผิดใบเดียวไม่บันทึกเลย · <b>ภาษี</b>: ใส่ในแถวของบัญชีภาษี ระบบเติมแฟ้มภาษีซื้อ/ขาย/ภ.ง.ด.3/53 ให้</>}
        actions={<>
          {can('add') && <button className="primary" disabled={!ready || busy} onClick={() => setAsk(true)}>นำเข้า {ready ? `${res!.import_count} ใบ` : ''} <kbd>F9</kbd></button>}
          <button onClick={() => nav('/gl/journals')}>รายการ <kbd>Esc</kbd></button>
        </>} />
      <div className="card ti-steps">
        <div className="ti-actions">
          <button type="button" onClick={() => download('/api/v1/gl/journal-import/template', 'import-journal.xlsx').then((n) => toast(`ดาวน์โหลด ${n} แล้ว`)).catch(setErr)}>⬇ 1. แบบฟอร์มตัวอย่าง (.xlsx)</button>
          {can('add') && <label className="btn primary-soft">⬆ 2. เลือกแฟ้มที่กรอกแล้ว (.xlsx / .csv)…<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          {file && <span className="muted small">แฟ้ม: <b>{file.name}</b></span>}
          {file && !res?.committed && <button type="button" disabled={busy} onClick={() => run(false)}>↻ ตรวจแฟ้มอีกครั้ง</button>}
          {busy && <span className="muted">กำลังตรวจ…</span>}
        </div>
        <div className="ji-legend">
          {NEED_GROUPS.map(([cls, needs]) => <span key={cls || 'opt'}>
            <b>{cls === 'req' ? 'ต้องใส่' : cls === 'cond' ? 'ใส่เมื่อมีภาษี (แถวบัญชีภาษี)' : 'ว่างได้'}:</b>{' '}
            {JOURNAL_IMPORT_COLUMNS.filter((c) => needs.includes(c.need)).map((c) => <span key={c.key} className={`chip ${cls}`} title={`${JOURNAL_IMPORT_NEED_LABEL[c.need]} — ${c.hint}`}>{journalImportHeader(c)}</span>)}
          </span>)}
        </div>
        <p className="hint">ใบที่ไม่มีภาษีเว้นช่องสีเหลืองว่างได้ทั้งหมด · ช่องเงินรับตัวเลขแบบข้อความ จุลภาค เลขไทย และขีด (-) แทนศูนย์ · วันที่แบบข้อความ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) หรือช่องวันที่ของ Excel · รายละเอียดและรูปแบบช่องอยู่ในแผ่น "คำอธิบาย" ของแบบฟอร์ม</p>
      </div>
      <ErrorBox error={err} />
      {res && <>
        <div className="ti-summary">
          {res.committed ? <Pill tone="m">✓ นำเข้าแล้ว {res.import_count} ใบ</Pill> : res.ok ? <Pill tone="n">พร้อมนำเข้า {res.import_count} ใบ</Pill> : <Pill tone="c">ต้องแก้ {res.errors.length} รายการ</Pill>}
          <span>เดบิตรวม <b><Money v={res.total_debit} /></b></span>
          <span>เครดิตรวม <b><Money v={res.total_credit} /></b></span>
          <span className={res.total_diff !== '0.00' ? 'warn-text' : 'muted'}>ผลต่าง <b><Money v={res.total_diff} /></b></span>
          {!!taxCount && <span>รายการภาษี <b>{taxCount}</b> รายการ</span>}
          {res.dup_count > 0 && <span className="warn-text">ซ้ำกับใบที่มีอยู่ <b>{res.dup_count}</b> ใบ{!res.committed && skipN ? ` (ไม่นำเข้า ${skipN})` : ''}</span>}
          {!res.committed && !res.ok && <span className="muted small">ผ่านการตรวจ {res.import_count} จาก {res.file_vouchers} ใบ — แก้ในแฟ้มแล้วเลือกแฟ้มใหม่ (ไม่มีอะไรถูกบันทึก)</span>}
          {unbalanced && <span className="warn-text small">ใบที่เดบิตไม่เท่าเครดิตนำเข้าไม่ได้ — ดูคอลัมน์ผลต่าง</span>}
        </div>
        {res.errors.length > 0 && <div className="table-wrap ti-errors">
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>แถวที่</th><th>ต้องแก้</th></tr></thead>
            <tbody>{res.errors.map((e, i) => <tr key={i}><td className="r num">{e.row}</td><td>{e.message}</td></tr>)}</tbody>
          </table>
        </div>}
        {res.vouchers.length > 0 && <div className="table-wrap">
          <table className="grid">
            <thead><tr>
              <th style={{ width: 60 }}>แถว</th><th style={{ width: 70 }}>สมุด</th><th style={{ width: 80 }}>กลุ่ม</th><th style={{ width: 130 }} title="ตรวจแฟ้ม: เลขที่กำหนดเอง / เลขที่ใบที่จะทับ · นำเข้าแล้ว: เลขที่บันทึกจริง">เลขที่ใบสำคัญ</th><th style={{ width: 105 }}>วันที่</th>
              <th style={{ width: 110 }}>อ้างอิง</th><th>คำอธิบาย</th><th className="r" style={{ width: 60 }}>บรรทัด</th><th className="r" style={{ width: 55 }} title="จำนวนรายการภาษีซื้อ/ขาย/หัก ณ ที่จ่ายที่จะเติมในแฟ้มภาษี">ภาษี</th>
              <th className="r" style={{ width: 115 }}>เดบิต</th><th className="r" style={{ width: 115 }}>เครดิต</th><th className="r" style={{ width: 90 }}>ผลต่าง</th><th style={{ width: 150 }}>สถานะ</th>
            </tr></thead>
            <tbody>{res.vouchers.map((x) => {
              const open = res.committed && (x.status === 'created' || x.status === 'overwritten') && !!x.voucher_no;
              const [label, tone] = STATUS[x.status];
              return <tr key={x.key} className={open ? 'row-open' : undefined} onClick={open ? () => nav(`/gl/journals?q=${encodeURIComponent(x.voucher_no!)}`) : x.match ? () => document.getElementById(`dup-${x.row}`)?.scrollIntoView({ behavior: 'smooth' }) : undefined}>
                <td className="r num muted">{x.row}</td><td className="mono">{x.book}</td><td className="mono">{x.group}</td>
                <td className="mono">{x.voucher_no ? (res.committed ? <b>{x.voucher_no}</b> : x.voucher_no) : <span className="muted small">ระบบออกให้</span>}</td><td><DateText v={x.date} /></td>
                <td className="mono small">{x.ref}</td><td>{x.description}</td><td className="r num">{x.lines}</td><td className="r num">{x.taxes ? x.taxes : ''}</td>
                <td className="r"><Money v={x.debit} /></td><td className="r"><Money v={x.credit} /></td><td className={`r ${x.diff !== '0.00' ? 'warn-text' : 'muted'}`}>{x.diff !== '0.00' ? <b><Money v={x.diff} /></b> : '0.00'}</td>
                <td><Pill tone={tone}>{label}</Pill>{x.status === 'dup' && x.action && <span className="small"> → {ACTION_LABEL[x.action]}</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {!res.committed && dups.length > 0 && <div className="ji-dups">
          <div className="ji-dups-head">
            <b>เลขที่หรืออ้างอิงซ้ำกับใบที่มีอยู่ {dups.length} ใบ</b><span className="muted small">— ดูเปรียบเทียบแล้วเลือกทีละใบ (ค่าเริ่มต้น "ไม่นำเข้า")</span>
            <span className="muted small">ใช้กับทุกใบ:</span>
            {(['skip', 'overwrite', 'new'] as Action[]).map((a) => <button key={a} type="button" disabled={busy || (a === 'overwrite' && !can('edit'))} onClick={() => chooseAll(a)}>{ACTION_LABEL[a]}</button>)}
          </div>
          {dups.map((x) => <DupCard key={x.key} x={x} hasTax={res.has_tax} busy={busy} canEdit={can('edit')} onPick={(a) => choose({ ...acts, [x.key]: a })} />)}
        </div>}
      </>}
      <KeyHints keys={[['F9', 'นำเข้า (เมื่อตรวจผ่าน)'], ['Esc', 'กลับรายการ']]} />
      {ask && res && <Confirm title="นำเข้าใบสำคัญ" okText={`นำเข้า ${res.import_count} ใบ`}
        text={<>บันทึกใบสำคัญ <b>{res.import_count}</b> ใบ{overNote} ยอดเดบิตรวม <b><Money v={res.import_debit} /></b> บาท และลงบัญชีทันที{taxNote} — ถ้าต้องการแก้ภายหลังให้แก้หรือยกเลิกทีละใบที่หน้าสมุดรายวัน</>}
        onOk={() => { setAsk(false); void run(true); }} onClose={() => setAsk(false)} />}
    </div>
  );
}

/** ใบซ้ำหนึ่งใบ: ในแฟ้ม ↔ ในระบบ (ช่องที่ต่างกันเน้นสี) + เลือก ทับ / สร้างใหม่ / ไม่นำเข้า */
function DupCard({ x, hasTax, busy, canEdit, onPick }: { x: VRow; hasTax: boolean; busy: boolean; canEdit: boolean; onPick: (a: Action) => void }) {
  const m = x.match!;
  const same = m.diffs.length === 0;
  return (
    <div className="card ji-dup" id={`dup-${x.row}`}>
      <div className="ji-dup-title">
        <b>แถว {x.row} · {x.book} กลุ่ม {x.group}</b>
        <span>ซ้ำกับ <b className="mono">{m.voucher_no}</b> ({m.by === 'voucher_no' ? 'เลขที่ใบสำคัญเดียวกัน' : 'อ้างอิงเดียวกันในสมุดเดียวกัน'}{m.doc_status === 'C' ? ' · ใบนั้นยกเลิกแล้ว' : ''})</span>
        {same ? <Pill tone="m">เหมือนกันทุกช่อง</Pill> : <Pill tone="d">ต่างกัน {m.diffs.length} จุด: {m.diffs.join(' · ')}</Pill>}
      </div>
      <div className="ji-acts" role="radiogroup">
        {(['skip', 'overwrite', 'new'] as Action[]).map((a) => {
          const off = busy || (a === 'overwrite' && (!m.can_overwrite || !canEdit));
          return <label key={a} className={off && a === 'overwrite' ? 'off' : undefined}>
            <input type="radio" name={`act-${x.key}`} checked={x.action === a} disabled={off} onChange={() => onPick(a)} />{ACTION_LABEL[a]}
          </label>;
        })}
      </div>
      {!m.can_overwrite && <p className="why">ทับไม่ได้: {m.why_not}</p>}
      {m.can_overwrite && !canEdit && <p className="why">ทับไม่ได้: ไม่มีสิทธิ์แก้ไขใบสำคัญ</p>}
      <div className="ji-cmp">
        <SideView title="ในแฟ้ม" s={m.file} o={m.current} tax={hasTax} />
        <SideView title={`ในระบบ ${m.voucher_no}`} s={m.current} o={m.file} tax={hasTax} />
      </div>
    </div>
  );
}

function SideView({ title, s, o, tax }: { title: string; s: Side; o: Side; tax: boolean }) {
  const up = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
  const df = (a: string | null | undefined, b: string | null | undefined) => (up(a) !== up(b) ? 'diff' : undefined);
  const dm = (a: string | undefined, b: string | undefined) => (Number(a ?? 0) !== Number(b ?? 0) ? 'diff' : undefined);
  const head: Array<[string, string | null, string | null]> = [['เลขที่ใบสำคัญ', s.voucher_no ?? '(ระบบออกให้)', o.voucher_no ?? '(ระบบออกให้)'], ['สมุด', s.book, o.book], ['วันที่', s.date, o.date], ['อ้างอิง', s.ref, o.ref], ['คำอธิบาย', s.description, o.description]];
  const taxKey = (t: CTax) => `${t.kind}|${up(t.no)}|${t.date}|${Number(t.base)}|${Number(t.amount)}`;
  const otherTax = new Set(o.taxes.map(taxKey));
  const fileSide = title === 'ในแฟ้ม';
  return (
    <div>
      <h4>{title}</h4>
      <table className="grid kv"><tbody>
        {head.map(([k, a, b]) => <tr key={k}><td>{k}</td><td className={k === 'เลขที่ใบสำคัญ' && (!s.voucher_no || !o.voucher_no) ? undefined : df(a, b)}>{k === 'วันที่' && a ? <DateText v={a} /> : a}</td></tr>)}
        <tr><td>ยอดเงิน</td><td className={dm(s.debit, o.debit)}><Money v={s.debit} /></td></tr>
      </tbody></table>
      <table className="grid">
        <thead><tr><th>บัญชี</th><th>คำอธิบายรายการ</th><th>แผนก</th><th>Job</th><th className="r">เดบิต</th><th className="r">เครดิต</th></tr></thead>
        <tbody>{s.lines.map((l, i) => { const p = o.lines[i]; return <tr key={i}>
          <td className={`mono ${df(l.account, p?.account) ?? ''}`}>{l.account}</td><td className={df(l.description, p?.description)}>{l.description}</td>
          <td className={df(l.department, p?.department)}>{l.department}</td><td className={df(l.job, p?.job)}>{l.job}</td>
          <td className={`r ${dm(l.debit, p?.debit) ?? ''}`}>{Number(l.debit) ? <Money v={l.debit} /> : ''}</td><td className={`r ${dm(l.credit, p?.credit) ?? ''}`}>{Number(l.credit) ? <Money v={l.credit} /> : ''}</td>
        </tr>; })}</tbody>
      </table>
      {!tax && fileSide ? (o.taxes.length > 0 && <p className="why">แฟ้มไม่มีคอลัมน์ภาษี — ทับเอกสารเดิมแล้วรายการภาษีเดิมคงไว้</p>) : (s.taxes.length > 0 || o.taxes.length > 0) && <table className="grid">
        <thead><tr><th>ภาษี</th><th>เลขที่</th><th>วันที่</th><th className="r">ฐาน</th><th className="r">ภาษี</th></tr></thead>
        <tbody>{s.taxes.length ? s.taxes.map((t, i) => { const c = !tax || otherTax.has(taxKey(t)) ? undefined : 'diff'; return <tr key={i}>
          <td className={c}>{TAX_LABEL[t.kind] ?? t.kind}</td><td className={`mono ${c ?? ''}`}>{t.no}</td><td className={c}><DateText v={t.date} /></td><td className={`r ${c ?? ''}`}><Money v={t.base} /></td><td className={`r ${c ?? ''}`}><Money v={t.amount} /></td>
        </tr>; }) : <tr><td colSpan={5} className="muted diff">ไม่มีรายการภาษี</td></tr>}</tbody>
      </table>}
    </div>
  );
}
