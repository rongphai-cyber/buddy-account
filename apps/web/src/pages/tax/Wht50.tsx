import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { d, fmt, todayIso, wht50FormOf, wht50Layout, wht50RowOf, WHT50_FORMS, WHT50_ROWS, type Wht50Data, type Wht50Form, type Wht50Item, type Wht50Row } from '@buddy/core';
import { api } from '../../api';
import { DateInput, ErrorBox, Field, KeyHints, MoneyInput, navKey, PageHead, useHotkeys } from '../../ui';

const PT = 25.4 / 72;   // 1 pt = 0.3528 mm
const mm = (v: number) => `${(v * PT).toFixed(3)}mm`;

/** ข้อความที่ยาวเกินช่อง ย่อขนาดตัวอักษรให้พอดีช่อง (แบบฟอร์มจริงมีที่จำกัด) */
function FitText({ it }: { it: Wht50Item }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = `${it.size}pt`;
    const over = el.scrollWidth / Math.max(1, el.clientWidth);
    if (over > 1.001) el.style.fontSize = `${(it.size / over).toFixed(2)}pt`;
  }, [it.text, it.size, it.w]);
  return (
    <span ref={ref} className="w50-t" data-key={it.key}
      style={{ left: mm(it.x), top: mm(it.y), width: mm(it.w), height: mm(it.h), justifyContent: it.align === 'left' ? 'flex-start' : it.align === 'right' ? 'flex-end' : 'center', fontWeight: it.bold ? 700 : 400 }}>
      {it.text}
    </span>
  );
}

/** หนึ่งหน้า A4: ภาพแบบฟอร์มของกรมสรรพากร + ข้อความในตำแหน่งช่องกรอกของแบบ */
export function Wht50Sheet({ data }: { data: Wht50Data }) {
  const { items } = useMemo(() => wht50Layout(data), [data]);
  return (
    <div className="w50-sheet">
      <img src="/forms/wht50.png" alt="แบบหนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ" draggable={false} />
      {items.map((it) => <FitText key={it.key} it={it} />)}
    </div>
  );
}

interface Company { name_th: string; address_th_1: string; address_th_2: string; tax_id: string | null; tax_branch_no: string }
interface SupRow { id: string; code: string; title: string | null; name: string; tax_id: string | null; wht_form: string | null }
interface SupDetail { id: string; code: string; title: string | null; name: string; address_1: string | null; address_2: string | null; address_3: string | null; zip_code: string | null; tax_id: string | null; tax_branch_no: string | null; wht_form: string | null; wht_rate: string | null; wht_condition: string | null; wht_income_desc: string | null }
interface Line { key: number; row: Wht50Row; date: string; amount: string; tax: string; taxEdited: boolean }
let seq = 0;
const joinAddr = (...a: Array<string | null | undefined>) => a.map((x) => (x ?? '').trim()).filter(Boolean).join(' ');

/**
 * พิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) สำหรับ ภ.ง.ด.3 / ภ.ง.ด.53 — ตามแบบของกรมสรรพากรทุกประการ
 * ตอนนี้ป้อนเองหรือเลือกผู้จำหน่าย; เมื่อมีเอกสารจ่ายชำระ (P3) จะพิมพ์จากรายการหัก ณ ที่จ่ายที่บันทึกไว้โดยตรง
 */
interface WhtEntry { id: string; form_type: string; certificate_no: string | null; certificate_date: string; payee_name: string; payee_address: string | null; payee_tax_id: string | null; payee_tax_branch_no: string | null;
  condition: string | null; social_security_amount: string | null; provident_fund_amount: string | null;
  lines: Array<{ id: string; income_type: string | null; rate: string; paid_amount: string; tax_amount: string; certificate_date: string }> }

export function Wht50Page() {
  const company = useQuery({ queryKey: ['company'], queryFn: () => api.get<Company>('/api/v1/company') });
  const [payer, setPayer] = useState<{ name: string; address: string; tax_id: string; branch_no: string } | null>(null);
  if (!payer && company.data) setPayer({ name: company.data.name_th, address: joinAddr(company.data.address_th_1, company.data.address_th_2), tax_id: company.data.tax_id ?? '', branch_no: company.data.tax_branch_no });
  const [payee, setPayee] = useState({ name: '', address: '', tax_id: '', branch_no: '' });
  const [rate, setRate] = useState('3');
  const [h, setH] = useState({ book_no: '', run_no: '', seq_no: '', form: '53' as Wht50Form, condition: '1' as Wht50Data['condition'], condition_other: '', issue_date: todayIso(), rate_4b14: '', text_4b25: '', text_6: '', gpf: '', sso: '', pvd: '' });
  const [lines, setLines] = useState<Line[]>([{ key: ++seq, row: '5', date: todayIso(), amount: '', tax: '', taxEdited: false }]);
  const [copies, setCopies] = useState({ c1: true, c2: true });
  const [q, setQ] = useState('');
  const [err, setErr] = useState<unknown>(null);
  // พิมพ์จากรายการในแฟ้มภาษีหัก ณ ที่จ่าย (?entry=) — รายการแบบเดียวกันของเอกสารเดียวกันรวมในฉบับเดียว
  const [params] = useSearchParams();
  const entryId = params.get('entry');
  const entry = useQuery({ enabled: !!entryId, queryKey: ['wht', 'one', entryId], queryFn: () => api.get<WhtEntry>(`/api/v1/wht/${entryId}`) });
  const [loaded, setLoaded] = useState<string | null>(null);
  if (entry.data && loaded !== entry.data.id) {
    const w = entry.data;
    setLoaded(w.id);
    setPayee({ name: w.payee_name, address: w.payee_address ?? '', tax_id: w.payee_tax_id ?? '', branch_no: w.payee_tax_branch_no ?? '' });
    const [book, run] = (w.certificate_no ?? '').includes('/') ? (w.certificate_no ?? '').split('/', 2) : ['', w.certificate_no ?? ''];
    const date = String(w.certificate_date).slice(0, 10);
    const rows = w.lines.map((l) => ({ row: wht50RowOf(l.income_type), l }));
    setH((x) => ({ ...x, book_no: book ?? '', run_no: run ?? '', form: w.form_type === 'S03' ? '3' : '53', condition: (['1', '2', '3'].includes(w.condition ?? '') ? w.condition : '1') as Wht50Data['condition'], issue_date: date,
      text_6: rows.find((r) => r.row === '6')?.l.income_type ?? '', sso: w.social_security_amount ? d(w.social_security_amount).toString() : '', pvd: w.provident_fund_amount ? d(w.provident_fund_amount).toString() : '' }));
    setLines(rows.map(({ row, l }) => ({ key: ++seq, row, date: String(l.certificate_date).slice(0, 10), amount: d(l.paid_amount).toFixed(2), tax: d(l.tax_amount).toFixed(2), taxEdited: true })));
    if (w.lines[0]) setRate(d(w.lines[0].rate).toString());
  }
  const sups = useQuery({ enabled: q.trim().length > 0, queryKey: ['suppliers', 'w50', q], queryFn: () => api.get<{ rows: SupRow[] }>('/api/v1/suppliers', { q, limit: 12 }), placeholderData: (p) => p });

  const pickSupplier = async (id: string) => {
    setQ(''); setErr(null);
    try {
      const s = await api.get<SupDetail>(`/api/v1/suppliers/${id}`);
      setPayee({ name: joinAddr(s.title, s.name), address: joinAddr(s.address_1, s.address_2, s.address_3, s.zip_code), tax_id: s.tax_id ?? '', branch_no: s.tax_branch_no ?? '' });
      setH((x) => ({ ...x, form: wht50FormOf(s.wht_form, s.tax_id), condition: (['1', '2', '3'].includes(s.wht_condition ?? '') ? s.wht_condition : '1') as Wht50Data['condition'], text_6: x.text_6 }));
      if (s.wht_rate && !d(s.wht_rate).isZero()) setRate(d(s.wht_rate).toString());
    } catch (e) { setErr(e); }
  };
  const taxOf = (amount: string, r = rate) => (amount ? d(amount).times(d(r || 0)).div(100).toDecimalPlaces(2).toFixed(2) : '');
  const setLine = (k: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => {
    if (l.key !== k) return l;
    const n = { ...l, ...p };
    if (p.amount !== undefined && !n.taxEdited) n.tax = taxOf(p.amount);
    return n;
  }));
  const changeRate = (r: string) => { setRate(r); setLines((ls) => ls.map((l) => (l.taxEdited ? l : { ...l, tax: taxOf(l.amount, r) }))); };

  const data: Wht50Data = {
    book_no: h.book_no, run_no: h.run_no, seq_no: h.seq_no,
    payer: payer ?? { name: '' }, payee,
    form: h.form, condition: h.condition, condition_other: h.condition_other, issue_date: h.issue_date,
    lines: lines.filter((l) => l.amount || l.tax).map((l) => ({ row: l.row, date: l.date || h.issue_date, amount: l.amount || '0', tax: l.tax || '0' })),
    rate_4b14: h.rate_4b14, text_4b25: h.text_4b25, text_6: h.text_6,
    funds: { gpf: h.gpf, sso: h.sso, pvd: h.pvd },
  };
  const totals = wht50Layout(data);
  const problems = [
    !payee.name && 'ป้อนชื่อผู้ถูกหักภาษี',
    !data.lines.length && 'ป้อนจำนวนเงินที่จ่ายอย่างน้อย 1 บรรทัด',
    payee.tax_id && ![10, 13].includes(payee.tax_id.replace(/\D/g, '').length) && 'เลขผู้เสียภาษีของผู้ถูกหักต้องเป็น 13 หลัก',
    !copies.c1 && !copies.c2 && 'เลือกฉบับที่จะพิมพ์',
  ].filter(Boolean) as string[];
  const print = () => { if (problems.length) return; window.print(); if (entryId) api.post(`/api/v1/wht/${entryId}/printed`, {}).catch(() => undefined); };
  useHotkeys({ 'Ctrl+P': print, F9: print }, []);

  return (
    <div className="page" data-tone="finance">
      <PageHead eyebrow="การเงิน › ภาษีหัก ณ ที่จ่าย" title="พิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)"
        lead="ตามแบบของกรมสรรพากร สำหรับผู้ถูกหักตาม ภ.ง.ด.3 และ ภ.ง.ด.53 — เลือกผู้จำหน่ายเพื่อดึงชื่อ ที่อยู่ เลขผู้เสียภาษี แบบ และอัตราที่หักอัตโนมัติ · พิมพ์จากรายการที่บันทึกแล้วได้ที่ แฟ้มภาษีหัก ณ ที่จ่าย"
        actions={<button className="primary" disabled={problems.length > 0} title={problems[0]} onClick={print}>🖨 พิมพ์ <kbd>Ctrl+P</kbd></button>} />
      <ErrorBox error={err ?? company.error ?? entry.error} />
      <div className="w50-layout">
        <div className="w50-editor no-print" onKeyDown={navKey}>
          <fieldset><legend>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (บริษัท)</legend>
            {payer && <div className="form-grid">
              <Field label="ชื่อ" wide><input value={payer.name} maxLength={160} onChange={(e) => setPayer({ ...payer, name: e.target.value })} /></Field>
              <Field label="ที่อยู่" wide><input value={payer.address} maxLength={250} onChange={(e) => setPayer({ ...payer, address: e.target.value })} /></Field>
              <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)"><input className="mono" value={payer.tax_id} maxLength={17} onChange={(e) => setPayer({ ...payer, tax_id: e.target.value })} /></Field>
              <Field label="สาขา#" hint="00000 = สำนักงานใหญ่"><input className="mono" value={payer.branch_no} maxLength={5} onChange={(e) => setPayer({ ...payer, branch_no: e.target.value })} /></Field>
            </div>}
          </fieldset>
          <fieldset><legend>ผู้ถูกหักภาษี ณ ที่จ่าย</legend>
            <div className="w50-search">
              <input type="search" placeholder="🔍 ค้นหาผู้จำหน่าย: รหัส ชื่อ เลขผู้เสียภาษี" value={q} onChange={(e) => setQ(e.target.value)} data-noenter aria-label="ค้นหาผู้จำหน่าย" />
              {q.trim() && <ul className="w50-results" role="listbox">
                {sups.data?.rows.map((s) => <li key={s.id} role="option" aria-selected={false} tabIndex={0} onClick={() => pickSupplier(s.id)} onKeyDown={(e) => e.key === 'Enter' && pickSupplier(s.id)}><b className="mono">{s.code}</b> {joinAddr(s.title, s.name)} <span className="muted small">{s.tax_id}</span></li>)}
                {sups.data && !sups.data.rows.length && <li className="muted">ไม่พบ — ป้อนชื่อเองด้านล่างได้</li>}
              </ul>}
            </div>
            <div className="form-grid">
              <Field label="ชื่อ" req wide><input value={payee.name} maxLength={160} onChange={(e) => setPayee({ ...payee, name: e.target.value })} /></Field>
              <Field label="ที่อยู่" wide><input value={payee.address} maxLength={250} onChange={(e) => setPayee({ ...payee, address: e.target.value })} /></Field>
              <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)" hint="บุคคลธรรมดาใช้เลขบัตรประชาชน"><input className="mono" value={payee.tax_id} maxLength={17} onChange={(e) => setPayee({ ...payee, tax_id: e.target.value })} /></Field>
              <Field label="สาขา#" hint="ว่าง = ไม่แสดง · 00000 = สำนักงานใหญ่"><input className="mono" value={payee.branch_no} maxLength={5} onChange={(e) => setPayee({ ...payee, branch_no: e.target.value })} /></Field>
            </div>
          </fieldset>
          <fieldset><legend>เอกสาร</legend>
            <div className="form-grid w50-grid4">
              <Field label="เล่มที่"><input value={h.book_no} maxLength={10} onChange={(e) => setH({ ...h, book_no: e.target.value })} /></Field>
              <Field label="เลขที่"><input value={h.run_no} maxLength={12} onChange={(e) => setH({ ...h, run_no: e.target.value })} /></Field>
              <Field label="ลำดับที่ในแบบ" hint="ตรงกับลำดับในใบแนบ ภ.ง.ด."><input value={h.seq_no} maxLength={6} onChange={(e) => setH({ ...h, seq_no: e.target.value })} /></Field>
              <Field label="ในแบบ"><select value={h.form} onChange={(e) => setH({ ...h, form: e.target.value as Wht50Form })}>{WHT50_FORMS.map((f, i) => <option key={f} value={f}>({i + 1}) ภ.ง.ด.{f}</option>)}</select></Field>
              <Field label="วันที่ออกหนังสือรับรอง"><DateInput value={h.issue_date} onChange={(v) => setH({ ...h, issue_date: v })} /></Field>
              <Field label="ผู้จ่ายเงิน">
                <select value={h.condition} onChange={(e) => setH({ ...h, condition: e.target.value as Wht50Data['condition'] })}>
                  <option value="1">(1) หัก ณ ที่จ่าย</option><option value="2">(2) ออกให้ตลอดไป</option><option value="3">(3) ออกให้ครั้งเดียว</option><option value="4">(4) อื่น ๆ (ระบุ)</option>
                </select>
              </Field>
              {h.condition === '4' && <Field label="อื่น ๆ ระบุ"><input value={h.condition_other} maxLength={40} onChange={(e) => setH({ ...h, condition_other: e.target.value })} /></Field>}
              <Field label="อัตราภาษีที่หัก (%)" hint="คำนวณภาษีให้อัตโนมัติ (แก้รายบรรทัดได้)"><input type="number" min={0} max={100} step="0.01" value={rate} onChange={(e) => changeRate(e.target.value)} /></Field>
            </div>
          </fieldset>
          <fieldset><legend>ประเภทเงินได้พึงประเมินที่จ่าย</legend>
            <table className="grid">
              <thead><tr><th>ประเภทเงินได้</th><th style={{ width: 130 }}>วันที่จ่าย</th><th className="r" style={{ width: 140 }}>จำนวนเงินที่จ่าย</th><th className="r" style={{ width: 120 }}>ภาษีที่หัก</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td><select value={l.row} onChange={(e) => setLine(l.key, { row: e.target.value as Wht50Row })} aria-label="ประเภทเงินได้">{WHT50_ROWS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                    <td><DateInput value={l.date} onChange={(v) => setLine(l.key, { date: v })} /></td>
                    <td><MoneyInput value={l.amount} onChange={(v) => setLine(l.key, { amount: v })} aria-label="จำนวนเงินที่จ่าย" /></td>
                    <td><MoneyInput value={l.tax} onChange={(v) => setLine(l.key, { tax: v, taxEdited: true })} aria-label="ภาษีที่หัก" /></td>
                    <td><button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={2}><button type="button" onClick={() => setLines((ls) => [...ls, { key: ++seq, row: ls.at(-1)?.row ?? '5', date: ls.at(-1)?.date ?? h.issue_date, amount: '', tax: '', taxEdited: false }])}>+ เพิ่มบรรทัด</button></td>
                <td className="r"><b>{fmt(totals.total_amount)}</b></td><td className="r"><b>{fmt(totals.total_tax)}</b></td><td />
              </tr></tfoot>
            </table>
            <p className="small">ตัวอักษร: <b>{totals.total_words}</b></p>
            <div className="form-grid w50-grid4">
              {lines.some((l) => l.row === '4b1.4') && <Field label="(1.4) อัตราอื่น ๆ ระบุ"><input value={h.rate_4b14} maxLength={10} onChange={(e) => setH({ ...h, rate_4b14: e.target.value })} /></Field>}
              {lines.some((l) => l.row === '4b2.5') && <Field label="(2.5) อื่น ๆ ระบุ"><input value={h.text_4b25} maxLength={60} onChange={(e) => setH({ ...h, text_4b25: e.target.value })} /></Field>}
              {lines.some((l) => l.row === '6') && <Field label="6. อื่น ๆ ระบุ" wide><input value={h.text_6} maxLength={70} onChange={(e) => setH({ ...h, text_6: e.target.value })} /></Field>}
            </div>
            <details><summary>เงินที่จ่ายเข้ากองทุน (ถ้ามี)</summary>
              <div className="form-grid w50-grid4">
                <Field label="กบข./กสจ./กองทุนสงเคราะห์ครูฯ"><MoneyInput value={h.gpf} onChange={(v) => setH({ ...h, gpf: v })} /></Field>
                <Field label="กองทุนประกันสังคม"><MoneyInput value={h.sso} onChange={(v) => setH({ ...h, sso: v })} /></Field>
                <Field label="กองทุนสำรองเลี้ยงชีพ"><MoneyInput value={h.pvd} onChange={(v) => setH({ ...h, pvd: v })} /></Field>
              </div>
            </details>
          </fieldset>
          <fieldset><legend>พิมพ์</legend>
            <label className="check"><input type="checkbox" checked={copies.c1} onChange={(e) => setCopies({ ...copies, c1: e.target.checked })} /> ฉบับที่ 1 (ผู้ถูกหักภาษี ใช้แนบพร้อมแบบแสดงรายการภาษี)</label>
            <label className="check"><input type="checkbox" checked={copies.c2} onChange={(e) => setCopies({ ...copies, c2: e.target.checked })} /> ฉบับที่ 2 (ผู้ถูกหักภาษี เก็บไว้เป็นหลักฐาน)</label>
            {problems.length > 0 && <ul className="bad small">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <p className="hint">พิมพ์บนกระดาษ A4 · ในหน้าต่างพิมพ์ให้เลือกขนาด "จริง (100%)" และไม่ใส่หัว/ท้ายกระดาษ</p>
          </fieldset>
        </div>
        <div className="w50-preview" aria-label="ตัวอย่างก่อนพิมพ์"><Wht50Sheet data={{ ...data, copy: copies.c1 ? 1 : 2 }} /></div>
      </div>
      <KeyHints keys={[['Ctrl+P / F9', 'พิมพ์'], ['Enter', 'ช่องถัดไป']]} />
      {createPortal(<div className="w50-print">{copies.c1 && <Wht50Sheet data={{ ...data, copy: 1 }} />}{copies.c2 && <Wht50Sheet data={{ ...data, copy: 2 }} />}</div>, document.body)}
    </div>
  );
}
