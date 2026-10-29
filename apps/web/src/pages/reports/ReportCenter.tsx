import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fmt, formatDate, REPORT_TREE, todayIso, type ReportDef, type ReportFilter, type ReportNode, type ReportResult, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { SearchPick } from '../../components/LkSelect';
import { cx, DateInput, ErrorBox, KeyHints, PageHead, toast, useHotkeys } from '../../ui';

/** ศูนย์รายงาน (คู่มือบทที่ 17 S-RP-01..04) — ต้นไม้รายงานตามรหัส Express · ขอบเขต · แสดงผล พิมพ์ ส่งออก */
type Vals = Record<string, string | boolean>;
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
  const [open, setOpen] = useState<Set<string>>(() => new Set([sp.get('g') ?? '1']));
  useEffect(() => { const g = sp.get('g'); if (g) setOpen((o) => new Set([...o, g])); }, [sp]);
  const [def, setDef] = useState<ReportDef | null>(null);
  const [vals, setVals] = useState<Vals>({});
  const [res, setRes] = useState<ReportResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pick = (x: ReportDef) => { setDef(x); setVals(defaults(x, work)); setRes(null); setErr(null); };
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
  const print = () => {
    const st = document.createElement('style');
    st.textContent = `@page { size: A4 ${res?.landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`;
    document.head.appendChild(st); window.print(); setTimeout(() => st.remove(), 500);
  };
  useHotkeys({ F5: run, 'Ctrl+F2': all, 'Ctrl+P': res ? print : undefined }, [def, vals, res]);
  return (
    <div className="page" data-tone="reports">
      <div className="no-print"><PageHead eyebrow="รายงาน" title="พิมพ์รายงาน" lead="เลือกรายงานจากต้นไม้ (รหัสเดียวกับ Express เช่น 1.4.1 = 141) → กรอกขอบเขต (ว่าง = ทั้งหมด, Ctrl+F2 เลือกทั้งหมด) → F5 แสดงรายงาน → พิมพ์/บันทึก PDF หรือส่งออก Excel" /></div>
      <div className="rpt-layout">
        <aside className="rpt-side no-print">
          <ErrorBox error={avail.error} />
          <Tree nodes={REPORT_TREE} sel={def?.code ?? null} open={open} toggle={(c) => setOpen((o) => { const n = new Set(o); if (n.has(c)) n.delete(c); else n.add(c); return n; })} pick={pick} avail={codes} />
        </aside>
        <section className="rpt-main">
          {!def && <p className="empty no-print">เลือกรายงานจากต้นไม้ด้านซ้าย</p>}
          {def && <div className="rpt-scope no-print">
            <h2>{def.code}. {def.title}</h2>
            <div className="rpt-filters">{def.filters.map((f) => <FilterField key={f.key} f={f} v={vals} set={(p) => setVals((x) => ({ ...x, ...p }))} />)}</div>
            <div className="toolbar"><button className="primary" disabled={busy} onClick={run}>{busy ? 'กำลังประมวลผล…' : 'แสดงรายงาน'} <kbd>F5</kbd></button><button onClick={all}>ขอบเขตทั้งหมด <kbd>Ctrl+F2</kbd></button>
              {res && <><button onClick={print}>🖨 พิมพ์ / PDF <kbd>Ctrl+P</kbd></button><button onClick={() => download(res, 'xls', me?.company?.name_th ?? '', ys)}>Excel</button><button onClick={() => download(res, 'csv', me?.company?.name_th ?? '', ys)}>CSV</button><button onClick={() => download(res, 'txt', me?.company?.name_th ?? '', ys)}>ข้อความ</button></>}</div>
          </div>}
          <ErrorBox error={err} />
          {res && <div className="rpt-out">
            <div className="rpt-head"><b>{me?.company?.name_th}</b><h3>{res.code}. {res.title}</h3>{res.subtitle && <p>{res.subtitle}</p>}<p className="small muted">พิมพ์วันที่ {formatDate(todayIso(), ys)}</p></div>
            {res.truncated && <p className="bad small no-print">ข้อมูลมาก แสดงบางส่วน — จำกัดขอบเขตให้แคบลง (รายละเอียดแสดงเมื่อไม่เกิน 5,000 เอกสาร)</p>}
            <div className="table-wrap">
              <table className="grid report">
                <thead><tr>{res.columns.map((c) => <th key={c.key} className={cx(['money', 'qty', 'int'].includes(c.kind ?? '') && 'r')} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {res.rows.map((row, i) => (
                    <tr key={i} className={cx(row.t === 'group' && 'rpt-group', row.t === 'sub' && 'rpt-sub', row.t === 'total' && 'rpt-total', row.t === 'detail' && 'rpt-detail', row.muted && 'cancelled', row.link && 'row-open')}
                      onClick={() => row.link && nav(row.link)}>
                      {res.columns.map((c) => <td key={c.key} className={cx(['money', 'qty', 'int'].includes(c.kind ?? '') && 'r num', c.kind === 'mono' && 'mono')}>{cell(row.t === 'detail' && c.kind === 'date' ? 'text' : c.kind, row.c[c.key], ys)}</td>)}
                    </tr>
                  ))}
                  {!res.rows.length && <tr><td colSpan={res.columns.length} className="empty">ไม่มีข้อมูลตามขอบเขตนี้</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}
          <KeyHints keys={[['F5', 'แสดงรายงาน'], ['Ctrl+F2', 'ขอบเขตทั้งหมด'], ['Ctrl+P', 'พิมพ์'], ['คลิกแถว', 'เปิดเอกสาร']]} />
        </section>
      </div>
    </div>
  );
}
