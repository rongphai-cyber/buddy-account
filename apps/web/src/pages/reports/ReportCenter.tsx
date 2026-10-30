import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { findReport, fmt, formatDate, REPORT_TREE, todayIso, type ReportDef, type ReportFilter, type ReportNode, type ReportResult, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { Confirm, cx, DateInput, ErrorBox, Field, KeyHints, Modal, PageHead, toast, useHotkeys } from '../../ui';

/** ศูนย์รายงาน (คู่มือบทที่ 17 S-RP-01..04) — ต้นไม้รายงานตามรหัส Express · ขอบเขต · แสดงผล พิมพ์ ส่งออก */
type Vals = Record<string, string | boolean>;
/** รายงานที่ผู้ใช้สร้างจากรายงานต้นฉบับ (S-RD-03/04): ขอบเขตที่บันทึกไว้ + คอลัมน์ที่ซ่อน + ชื่อรายงาน */
type CustomRpt = { id: string; code: string; base_code: string; name: string; params: Vals; hidden_cols: string[]; landscape: boolean | null };
const PICK: Partial<Record<string, { endpoint: string; params?: Record<string, string> }>> = {
  customer: { endpoint: '/api/v1/customers' }, supplier: { endpoint: '/api/v1/suppliers' }, item: { endpoint: '/api/v1/item-search', params: { module: 'AR' } },
};
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
function defaults(def: ReportDef, work: string): Vals {
  const v: Vals = {};
  for (const f of def.filters) {
    if (f.kind === 'dateRange') { v[`${f.key}_from`] = monthStart(work); v[`${f.key}_to`] = work; }
    else if (f.kind === 'asOf') v[f.key] = work;
    else if (f.kind === 'period') v[f.key] = work.slice(0, 7);
    else if (f.kind === 'dept') v[f.key] = '*';
    else if (f.kind === 'check') v[f.key] = !!f.default;
    else if (f.kind === 'select') v[f.key] = f.default ?? f.options[0]![0];
  }
  return v;
}

function Tree({ nodes, sel, open, toggle, pick, avail }: { nodes: ReportNode[]; sel: string | null; open: Set<string>; toggle: (c: string) => void; pick: (d: ReportDef) => void; avail: Set<string> }) {
  return (
    <ul className="rpt-tree">
      {nodes.map((n) => (
        <li key={n.code}>
          {n.children ? <button type="button" className="rpt-node" onClick={() => toggle(n.code)}>{open.has(n.code) ? '⊟' : '⊞'} {n.code} {n.title}</button>
            : <button type="button" className={cx('rpt-leaf', sel === n.code && 'on', !avail.has(n.code) && 'muted')} disabled={!avail.has(n.code)} title={avail.has(n.code) ? '' : 'ยังไม่เปิดใช้ (อยู่ระหว่างพัฒนา P5)'} onClick={() => n.def && pick(n.def)}>{n.code} {n.title}</button>}
          {n.children && open.has(n.code) && <Tree nodes={n.children} sel={sel} open={open} toggle={toggle} pick={pick} avail={avail} />}
        </li>
      ))}
    </ul>
  );
}

function FilterField({ f, v, set }: { f: ReportFilter; v: Vals; set: (p: Vals) => void }) {
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  if (f.kind === 'dateRange') return <div className="rpt-f"><label>{f.label ?? 'วันที่'}</label><DateInput value={s(`${f.key}_from`)} onChange={(x) => set({ [`${f.key}_from`]: x })} /><span>ถึง</span><DateInput value={s(`${f.key}_to`)} onChange={(x) => set({ [`${f.key}_to`]: x })} /></div>;
  if (f.kind === 'asOf') return <div className="rpt-f"><label>{f.label ?? 'ณ วันที่'}</label><DateInput value={s(f.key)} onChange={(x) => set({ [f.key]: x })} /></div>;
  if (f.kind === 'period') return <div className="rpt-f"><label>{f.label ?? 'สำหรับงวด (เดือน)'}</label><input type="month" value={s(f.key)} onChange={(e) => set({ [f.key]: e.target.value })} aria-label="งวด" /></div>;
  if (f.kind === 'dept') return <div className="rpt-f"><label>เลือกแผนก</label><input value={s(f.key)} maxLength={10} onChange={(e) => set({ [f.key]: e.target.value })} title="* = ทุกแผนก · A* = ขึ้นต้นด้วย A · ?A* = ตัวที่ 2 เป็น A" aria-label="แผนก" /></div>;
  if (f.kind === 'check') return <div className="rpt-f"><label className="check"><input type="checkbox" checked={!!v[f.key]} onChange={(e) => set({ [f.key]: e.target.checked })} /> {f.label}</label></div>;
  if (f.kind === 'select') return <div className="rpt-f"><label>{f.label}</label><select value={s(f.key)} onChange={(e) => set({ [f.key]: e.target.value })} aria-label={f.label}>{f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>;
  const label = f.kind === 'docNo' ? 'เลขที่เอกสาร' : f.label;
  const pk = f.kind === 'range' ? PICK[f.entity] : undefined;
  const box = (k: string) => pk
    ? <SearchPick<{ id: string; code: string; name?: string; name_th?: string }> endpoint={pk.endpoint} params={pk.params} value={s(k) ? { id: s(k), code: s(k) } : null} placeholder="ว่าง = ทั้งหมด" codeOf={(r: { code: string }) => r.code} label={(r: { name?: string; name_th?: string }) => r.name ?? r.name_th ?? ''}
        onPick={(r: { code: string } | null) => set({ [k]: r?.code ?? '' })} aria-label={`${label} ${k.endsWith('_from') ? 'จาก' : 'ถึง'}`} />
    : <input className="mono" value={s(k)} maxLength={30} placeholder="ว่าง = ทั้งหมด" onChange={(e) => set({ [k]: e.target.value })} aria-label={`${label} ${k.endsWith('_from') ? 'จาก' : 'ถึง'}`} />;
  return <div className="rpt-f"><label>{label}จาก</label>{box(`${f.key}_from`)}<span>ถึง</span>{box(`${f.key}_to`)}</div>;
}

const cell = (kind: string | undefined, v: string | number | null | undefined, ys: YearSystem) => {
  if (v === null || v === undefined || v === '') return '';
  // ข้อความในคอลัมน์ตัวเลข (เช่น ส่วนลด 10% ในบรรทัดรายละเอียด) แสดงตามที่เป็น
  if ((kind === 'money' || kind === 'qty' || kind === 'int') && Number.isNaN(Number(v))) return String(v);
  if (kind === 'money') return Number(v) === 0 ? '' : fmt(String(v));
  if (kind === 'qty') return fmt(String(v), { places: 2 });
  if (kind === 'int') return Number(v).toLocaleString();
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatDate(String(v).slice(0, 10), ys) : String(v);
  return String(v);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** ส่งออกแฟ้ม (S-RD-07): Excel (SpreadsheetML) · CSV (UTF-8) · ข้อความคั่นด้วย Tab */
function download(r: ReportResult, kind: 'xls' | 'csv' | 'txt', company: string, ys: YearSystem) {
  const head = r.columns.map((c) => c.label);
  const body = r.rows.map((row) => r.columns.map((c) => {
    const v = row.c[c.key];
    if (v === null || v === undefined) return '';
    return c.kind === 'money' || c.kind === 'qty' || c.kind === 'int' ? String(v) : cell(c.kind, v, ys);
  }));
  let blob: Blob, ext: string;
  if (kind === 'xls') {
    const num = (c: { kind?: string }) => c.kind === 'money' || c.kind === 'qty' || c.kind === 'int';
    const rowXml = (cells: string[], bold = false) => `<Row>${cells.map((x, i) => (x !== '' && num(r.columns[i]!) && !Number.isNaN(Number(x)) ? `<Cell${bold ? ' ss:StyleID="b"' : ''}><Data ss:Type="Number">${x}</Data></Cell>` : `<Cell${bold ? ' ss:StyleID="b"' : ''}><Data ss:Type="String">${esc(x)}</Data></Cell>`)).join('')}</Row>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="b"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="${esc(r.code)}"><Table>`
      + rowXml([company]) + rowXml([`${r.code} ${r.title}`]) + rowXml([r.subtitle ?? '']) + rowXml(head, true)
      + body.map((b, i) => rowXml(b, ['group', 'sub', 'total'].includes(r.rows[i]!.t ?? ''))).join('') + '</Table></Worksheet></Workbook>';
    blob = new Blob([xml], { type: 'application/vnd.ms-excel' }); ext = 'xls';
  } else {
    const sep = kind === 'csv' ? ',' : '\t';
    const q = (x: string) => (kind === 'csv' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x.replace(/\t/g, ' '));
    const txt = [head, ...body].map((l) => l.map(q).join(sep)).join('\r\n');
    blob = new Blob(['﻿' + txt], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }); ext = kind;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `รายงาน_${r.code}.${ext}`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReportCenterPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const work = me?.work_date ?? todayIso();
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  const avail = useQuery({ queryKey: ['rpt-available'], queryFn: () => api.get<{ codes: string[] }>('/api/v1/rpt/available') });
  const codes = useMemo(() => new Set(avail.data?.codes ?? []), [avail.data]);
  // ?g=5 หรือ ?g=5,5.A (เปิดหลายกลุ่ม เช่น เมนูตรวจสอบข้อมูล)
  const [open, setOpen] = useState<Set<string>>(() => new Set((sp.get('g') ?? '1').split(',')));
  useEffect(() => { const g = sp.get('g'); if (g) setOpen((o) => new Set([...o, ...g.split(',')])); }, [sp]);
  const [def, setDef] = useState<ReportDef | null>(null);
  const [vals, setVals] = useState<Vals>({});
  const [res, setRes] = useState<ReportResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const canCustom = useCan('RP.CUSTOM');
  const customs = useQuery({ queryKey: ['rpt-custom'], queryFn: () => api.get<CustomRpt[]>('/api/v1/rpt-custom') });
  const [custom, setCustom] = useState<CustomRpt | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saveAs, setSaveAs] = useState<{ code: string; name: string; landscape: string } | null>(null);
  const [askDel, setAskDel] = useState(false);
  const pick = (x: ReportDef) => { setDef(x); setVals(defaults(x, work)); setRes(null); setErr(null); setCustom(null); setHidden(new Set()); };
  const pickCustom = (c: CustomRpt) => {
    const base = findReport(c.base_code);
    if (!base) return toast(`ไม่พบรายงานต้นฉบับ ${c.base_code}`, 'bad');
    setDef(base); setVals({ ...defaults(base, work), ...c.params }); setRes(null); setErr(null); setCustom(c); setHidden(new Set(c.hidden_cols));
  };
  const saveCustom = async (asNew: boolean) => {
    if (!def) return;
    const f = asNew && saveAs ? saveAs : { code: custom?.code ?? '', name: custom?.name ?? def.title, landscape: custom?.landscape == null ? '' : custom.landscape ? 'Y' : 'N' };
    const body = { code: f.code.toUpperCase(), base_code: def.code, name: f.name, params: valsRef.current, hidden_cols: [...hidden], landscape: f.landscape === '' ? null : f.landscape === 'Y' };
    try {
      const r = asNew || !custom ? await api.post<{ id: string }>('/api/v1/rpt-custom', body) : await api.put<{ id: string }>(`/api/v1/rpt-custom/${custom.id}`, body);
      toast(`บันทึกรายงาน ${body.code} ${body.name} แล้ว`); setSaveAs(null);
      await qc.invalidateQueries({ queryKey: ['rpt-custom'] });
      setCustom({ id: r.id, ...body }); setOpen((o) => new Set([...o, 'U']));
    } catch (e) { setErr(e); }
  };
  const delCustom = async () => {
    setAskDel(false);
    if (!custom) return;
    try { await api.del(`/api/v1/rpt-custom/${custom.id}`); toast(`ลบรายงาน ${custom.code} แล้ว`); setCustom(null); qc.invalidateQueries({ queryKey: ['rpt-custom'] }); } catch (e) { setErr(e); }
  };
  const valsRef = useRef(vals);
  valsRef.current = vals;
  // กด F5 ขณะอยู่ในช่องวันที่: ออกจากช่องก่อนให้ค่าที่พิมพ์ถูกบันทึก แล้วจึงอ่านขอบเขตล่าสุด
  const run = () => {
    if (!def || busy) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(async () => {
      setBusy(true); setErr(null);
      try { setRes(await api.post<ReportResult>(`/api/v1/rpt/${def.code}/run`, { params: valsRef.current })); } catch (e) { setErr(e); } finally { setBusy(false); }
    }, 0);
  };
  // Ctrl+F2 = เลือกขอบเขตทั้งหมด (ล้างช่วงรหัส/เลขที่)
  const all = () => { if (!def) return; const v = { ...vals }; for (const f of def.filters) if (f.kind === 'range' || f.kind === 'docNo') { v[`${f.key}_from`] = ''; v[`${f.key}_to`] = ''; } setVals(v); toast('เลือกขอบเขตทั้งหมดแล้ว'); };
  // ผลที่แสดง/พิมพ์/ส่งออก: ตัดคอลัมน์ที่ซ่อน · ชื่อรายงานของผู้ใช้แทนชื่อต้นฉบับ
  const view = useMemo(() => res && { ...res, code: custom?.code ?? res.code, title: custom?.name ?? res.title, columns: res.columns.filter((c) => !hidden.has(c.key)), landscape: custom?.landscape ?? res.landscape }, [res, custom, hidden]);
  const print = () => {
    const st = document.createElement('style');
    st.textContent = `@page { size: A4 ${view?.landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`;
    document.head.appendChild(st); window.print(); setTimeout(() => st.remove(), 500);
  };
  useHotkeys({ F5: run, 'Ctrl+F2': all, 'Ctrl+P': res ? print : undefined }, [def, vals, res]);
  return (
    <div className="page" data-tone="reports">
      <div className="no-print"><PageHead eyebrow="รายงาน" title="พิมพ์รายงาน" lead="เลือกรายงานจากต้นไม้ (รหัสเดียวกับ Express เช่น 1.4.1 = 141) → กรอกขอบเขต (ว่าง = ทั้งหมด, Ctrl+F2 เลือกทั้งหมด) → F5 แสดงรายงาน → พิมพ์/บันทึก PDF หรือส่งออก Excel" /></div>
      <div className="rpt-layout">
        <aside className="rpt-side no-print">
          <ErrorBox error={avail.error} />
          <Tree nodes={REPORT_TREE} sel={custom ? null : def?.code ?? null} open={open} toggle={(c) => setOpen((o) => { const n = new Set(o); if (n.has(c)) n.delete(c); else n.add(c); return n; })} pick={pick} avail={codes} />
          <ul className="rpt-tree">
            <li><button type="button" className="rpt-node" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has('U')) n.delete('U'); else n.add('U'); return n; })}>{open.has('U') ? '⊟' : '⊞'} U รายงานที่สร้างเอง ({customs.data?.length ?? 0})</button>
              {open.has('U') && <ul className="rpt-tree">
                {customs.data?.map((c) => <li key={c.id}><button type="button" className={cx('rpt-leaf', custom?.id === c.id && 'on')} disabled={!codes.has(c.base_code)} onClick={() => pickCustom(c)} title={`จากรายงาน ${c.base_code}`}>{c.code} {c.name}</button></li>)}
                {!customs.data?.length && <li className="muted small" style={{ padding: '2px 8px' }}>เลือกรายงานต้นฉบับ กำหนดขอบเขต/คอลัมน์ แล้วกด "บันทึกเป็นรายงานของฉัน"</li>}
              </ul>}
            </li>
          </ul>
        </aside>
        <section className="rpt-main">
          {!def && <p className="empty no-print">เลือกรายงานจากต้นไม้ด้านซ้าย</p>}
          {def && <div className="rpt-scope no-print">
            <h2>{custom ? <>{custom.code}. {custom.name} <span className="muted small">(จากรายงาน {def.code} {def.title})</span></> : <>{def.code}. {def.title}</>}</h2>
            <div className="rpt-filters">{def.filters.map((f) => <FilterField key={f.key} f={f} v={vals} set={(p) => setVals((x) => ({ ...x, ...p }))} />)}</div>
            <div className="toolbar"><button className="primary" disabled={busy} onClick={run}>{busy ? 'กำลังประมวลผล…' : 'แสดงรายงาน'} <kbd>F5</kbd></button><button onClick={all}>ขอบเขตทั้งหมด <kbd>Ctrl+F2</kbd></button>
              {canCustom('add') && <button onClick={() => setSaveAs({ code: '', name: custom?.name ?? def.title, landscape: '' })} title="บันทึกขอบเขตและคอลัมน์ที่เลือกเป็นรายงานใหม่ (S-RD-03/04)">💾 บันทึกเป็นรายงานของฉัน</button>}
              {custom && canCustom('edit') && <button onClick={() => saveCustom(false)} title="บันทึกขอบเขต/คอลัมน์ปัจจุบันทับรายงานนี้">บันทึกทับ {custom.code}</button>}
              {custom && canCustom('delete') && <button onClick={() => setAskDel(true)}>ลบรายงาน {custom.code}</button>}
              {res && <><button onClick={print}>🖨 พิมพ์ / PDF <kbd>Ctrl+P</kbd></button><button onClick={() => download(view!, 'xls', me?.company?.name_th ?? '', ys)}>Excel</button><button onClick={() => download(view!, 'csv', me?.company?.name_th ?? '', ys)}>CSV</button><button onClick={() => download(view!, 'txt', me?.company?.name_th ?? '', ys)}>ข้อความ</button></>}</div>
          </div>}
          <ErrorBox error={err} />
          {view && <div className="rpt-out">
            {res && <details className="rpt-cols no-print"><summary>คอลัมน์ที่แสดง ({view.columns.length}/{res.columns.length})</summary>
              {res.columns.map((c) => <label key={c.key}><input type="checkbox" checked={!hidden.has(c.key)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n; })} /> {c.label}</label>)}</details>}
            <div className="rpt-head"><b>{me?.company?.name_th}</b><h3>{view.code}. {view.title}</h3>{view.subtitle && <p>{view.subtitle}</p>}<p className="small muted">พิมพ์วันที่ {formatDate(todayIso(), ys)}</p></div>
            {view.truncated && <p className="bad small no-print">ข้อมูลมาก แสดงบางส่วน — จำกัดขอบเขตให้แคบลง (รายละเอียดแสดงเมื่อไม่เกิน 5,000 เอกสาร)</p>}
            <div className="table-wrap">
              <table className="grid report">
                <thead><tr>{view.columns.map((c) => <th key={c.key} className={cx(['money', 'qty', 'int'].includes(c.kind ?? '') && 'r')} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {view.rows.map((row, i) => (
                    <tr key={i} className={cx(row.t === 'group' && 'rpt-group', row.t === 'sub' && 'rpt-sub', row.t === 'total' && 'rpt-total', row.t === 'detail' && 'rpt-detail', row.muted && 'cancelled', row.link && 'row-open')}
                      onClick={() => row.link && nav(row.link)}>
                      {view.columns.map((c) => <td key={c.key} className={cx(['money', 'qty', 'int'].includes(c.kind ?? '') && 'r num', c.kind === 'mono' && 'mono')}>{cell(row.t === 'detail' && c.kind === 'date' ? 'text' : c.kind, row.c[c.key], ys)}</td>)}
                    </tr>
                  ))}
                  {!view.rows.length && <tr><td colSpan={view.columns.length} className="empty">ไม่มีข้อมูลตามขอบเขตนี้</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}
          <KeyHints keys={[['F5', 'แสดงรายงาน'], ['Ctrl+F2', 'ขอบเขตทั้งหมด'], ['Ctrl+P', 'พิมพ์'], ['คลิกแถว', 'เปิดเอกสาร']]} />
        </section>
      </div>
      {saveAs && <Modal title="บันทึกเป็นรายงานของฉัน" size="confirm" onClose={() => setSaveAs(null)} footer={<><button onClick={() => setSaveAs(null)}>ยกเลิก</button><button className="primary" onClick={() => saveCustom(true)}>บันทึก</button></>}>
        <p className="small muted">จากรายงาน {def?.code} {def?.title} — เก็บขอบเขตที่กรอกไว้ และคอลัมน์ที่ซ่อน</p>
        <div className="form-grid">
          <Field label="รหัสรายงาน" req hint="เช่น U01 (อังกฤษ/ตัวเลข ไม่เกิน 10)"><input className="mono" value={saveAs.code} maxLength={10} autoFocus onChange={(e) => setSaveAs({ ...saveAs, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="พิมพ์แนว"><select value={saveAs.landscape} onChange={(e) => setSaveAs({ ...saveAs, landscape: e.target.value })}><option value="">ตามต้นฉบับ</option><option value="N">แนวตั้ง</option><option value="Y">แนวนอน</option></select></Field>
          <Field label="ชื่อรายงาน (หัวรายงาน)" req wide><input value={saveAs.name} maxLength={120} onChange={(e) => setSaveAs({ ...saveAs, name: e.target.value })} /></Field>
        </div>
      </Modal>}
      {askDel && custom && <Confirm title="ลบรายงานของฉัน" danger text={`ลบรายงาน ${custom.code} ${custom.name}? (รายงานต้นฉบับ ${custom.base_code} ไม่กระทบ)`} okText="ลบ" onOk={delCustom} onClose={() => setAskDel(false)} />}
    </div>
  );
}
