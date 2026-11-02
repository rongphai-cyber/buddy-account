import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bahtText, d, fmt, formatTaxId, MONTH_TH, MONTH_TH_SHORT, todayIso, type Wht50Data } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { cx, DateText, ErrorBox, KeyHints, Money, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { Wht50Sheet } from '../tax/Wht50';

const be = (y: number | string) => Number(y) + 543;
const monthLabel = (ym: string) => `${MONTH_TH[Number(ym.slice(5, 7)) - 1]} ${be(ym.slice(0, 4))}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${be(iso.slice(0, 4))}`;
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.max(1, Math.ceil(xs.length / n)) }, (_, i) => xs.slice(i * n, i * n + n));
const nameOf = (r: { title: string | null; first_name: string; last_name: string | null }) => `${r.title ?? ''}${r.first_name}${r.last_name ? ` ${r.last_name}` : ''}`;

/** พิมพ์ผ่าน portal .pay-print (ซ่อนหน้าจอโปรแกรมตอนพิมพ์) — สร้างเฉพาะตอนสั่งพิมพ์ แล้วเอาออก */
export function usePrintJob() {
  const [job, setJob] = useState<{ node: ReactNode; cls: string; done?: () => void } | null>(null);
  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => { window.print(); job.done?.(); setJob(null); }, 80);
    return () => clearTimeout(t);
  }, [job]);
  return {
    portal: job ? createPortal(<div className={job.cls}>{job.node}</div>, document.body) : null,
    print: (node: ReactNode, opt: { land?: boolean; w50?: boolean; done?: () => void } = {}) => setJob({ node, cls: opt.w50 ? 'w50-print' : cx('pay-print', opt.land && 'land'), done: opt.done }),
  };
}

/** Excel (SpreadsheetML) — ตัวเลขเป็นตัวเลขจริงใน Excel */
export function downloadXls(file: string, title: string[], head: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (v: string | number | null | undefined, bold = false) => {
    const st = bold ? ' ss:StyleID="b"' : '';
    if (v === null || v === undefined || v === '') return `<Cell${st}/>`;
    return typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? `<Cell${st}><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell${st}><Data ss:Type="String">${esc(String(v))}</Data></Cell>`;
  };
  const row = (cs: Array<string | number | null | undefined>, bold = false) => `<Row>${cs.map((c) => cell(c, bold)).join('')}</Row>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="b"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="Sheet1"><Table>`
    + title.map((t) => row([t], true)).join('') + row(head, true) + rows.map((r) => row(r)).join('') + '</Table></Worksheet></Workbook>';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' })); a.download = `${file}.xls`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- สลิปเงินเดือน
interface SlipData {
  company: { name: string; address: string; tax_id: string | null; phone: string | null }; logo: string | null;
  run: { doc_no: string | null; run_type: string; period_from: string; period_to: string; pay_date: string; draft: boolean };
  slips: Array<{ run_employee_id: string; code: string; name: string; position: string | null; department: string | null; tax_id: string | null; bank_account: string | null;
    earnings: Array<{ name: string; qty: string | null; amount: string; note: string | null }>; deductions: Array<{ name: string; amount: string }>;
    gross: string; deductions_total: string; net_pay: string; employer_paid_tax: string; ytd: { income: string; tax: string; sso: string; pvd: string } }>;
}
function Slip({ x, s }: { x: SlipData; s: SlipData['slips'][number] }) {
  const n = Math.max(s.earnings.length, s.deductions.length, 4);
  return (
    <div className="slip">
      <div className="slip-head">
        <div>{x.logo && <img src={x.logo} alt="" />}<h3>{x.company.name}</h3><div className="small">{x.company.address}{x.company.tax_id ? ` · เลขประจำตัวผู้เสียภาษี ${formatTaxId(x.company.tax_id)}` : ''}</div></div>
        <div style={{ textAlign: 'right' }}><h3>ใบแจ้งเงินเดือน (Payslip)</h3>{x.run.draft && <div className="slip-draft">ร่าง — ยังไม่บันทึก</div>}
          <div>งวด {dmy(x.run.period_from)} – {dmy(x.run.period_to)}</div><div>วันที่จ่าย {dmy(x.run.pay_date)}{x.run.doc_no ? ` · ${x.run.doc_no}` : ''}</div></div>
      </div>
      <div className="form-row"><span>รหัส <b>{s.code}</b></span><span>ชื่อ <b>{s.name}</b></span>{s.position && <span>ตำแหน่ง {s.position}</span>}{s.department && <span>แผนก {s.department}</span>}
        {s.tax_id && <span>เลขประจำตัว {s.tax_id}</span>}{s.bank_account && <span>โอนเข้าบัญชี {s.bank_account}</span>}</div>
      <div className="slip-grid">
        <table><thead><tr><th>รายได้</th><th className="r" style={{ width: "32%" }}>จำนวนเงิน</th></tr></thead>
          <tbody>{Array.from({ length: n }, (_, i) => { const e = s.earnings[i]; return <tr key={i}><td>{e ? <>{e.name}{e.qty ? ` (${d(e.qty).toString()})` : ''}</> : ' '}</td><td className="r">{e ? fmt(e.amount) : ''}</td></tr>; })}</tbody>
          <tfoot><tr><th>รวมรายได้</th><th className="r">{fmt(s.gross)}</th></tr></tfoot></table>
        <table><thead><tr><th>รายการหัก</th><th className="r" style={{ width: "32%" }}>จำนวนเงิน</th></tr></thead>
          <tbody>{Array.from({ length: n }, (_, i) => { const e = s.deductions[i]; return <tr key={i}><td>{e ? e.name : ' '}</td><td className="r">{e ? fmt(e.amount) : ''}</td></tr>; })}</tbody>
          <tfoot><tr><th>รวมรายการหัก</th><th className="r">{fmt(s.deductions_total)}</th></tr></tfoot></table>
      </div>
      <div className="slip-net"><span>เงินได้สุทธิ (Net Pay)</span><span>{fmt(s.net_pay)} บาท</span></div>
      <div className="slip-ytd">ยอดสะสมตั้งแต่ต้นปี: เงินได้ {fmt(s.ytd.income)} · ภาษีหัก ณ ที่จ่าย {fmt(s.ytd.tax)} · ประกันสังคม {fmt(s.ytd.sso)}{d(s.ytd.pvd).gt(0) ? ` · กองทุนสำรองเลี้ยงชีพ ${fmt(s.ytd.pvd)}` : ''}
        {d(s.employer_paid_tax).gt(0) ? ` · ภาษีที่บริษัทออกให้เดือนนี้ ${fmt(s.employer_paid_tax)}` : ''}<br />เอกสารนี้เป็นความลับเฉพาะตัว — หากมีข้อสงสัยกรุณาติดต่อฝ่ายบุคคลภายใน 7 วัน</div>
    </div>
  );
}
/** ปุ่มพิมพ์สลิป (ทั้งรอบ หรือรายคน reId) */
export function SlipPrintButton({ runId, reId, label = '🖨 สลิปเงินเดือน' }: { runId: string; reId?: string; label?: string }) {
  const can = useCan('PAY.RUN');
  const { portal, print } = usePrintJob();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const x = await api.get<SlipData>(`/api/v1/pay/runs/${runId}/slips`, { re: reId });
      if (!x.slips.length) { toast('ไม่มีพนักงานในรอบนี้', 'warn'); return; }
      print(<>{x.slips.map((s) => <Slip key={s.run_employee_id} x={x} s={s} />)}</>, { done: () => { api.post(`/api/v1/pay/runs/${runId}/slips/printed`, { count: x.slips.length }).catch(() => undefined); } });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return <>{<button disabled={!can('print') || busy} onClick={go} title="พิมพ์ 2 ใบต่อกระดาษ A4">{label}</button>}{portal}</>;
}

// ---------------------------------------------------------------- ภาษีและประกันสังคม
interface Payer { name: string; address: string; tax_id: string | null; branch_no: string; branch_name: string; sso_employer_no: string; sso_branch_no: string }
interface PRow { no: number; employee_id: string; code: string; tax_id: string | null; title: string | null; first_name: string; last_name: string | null; pay_date: string; income: string; tax: string; condition: string; address?: string; problem: string | null }
interface Pnd { payer: Payer; rows: PRow[]; count: number; income: string; tax: string; drafts: number; month?: string; year?: number }
interface SRow { no: number; code: string; tax_id: string | null; title: string | null; first_name: string; last_name: string | null; wage_paid: string; wage: string; ee: string; er: string; problem: string | null }
interface Sso { payer: Payer; rows: SRow[]; count: number; wage: string; wage_paid: string; ee: string; er: string; total: string; employee_rate: string; employer_rate: string; drafts: number }
interface W50 { rows: Array<{ employee_id: string; code: string; name: string; income: string; tax: string; sso: string; pvd: string; issued: boolean; print_count: number; problem: string | null; data: Wht50Data }>; drafts: number }

const COND = { '1': 'หัก ณ ที่จ่าย', '2': 'ออกให้ตลอดไป', '3': 'ออกให้ครั้งเดียว' } as Record<string, string>;
function PndPrint({ p, annual }: { p: Pnd; annual: boolean }) {
  const pages = chunk(p.rows, annual ? 12 : 18);
  return <>{pages.map((rows, pi) => (
    <div className="page" key={pi}>
      <div className="form-box">
        <h2>ใบแนบ ภ.ง.ด.1{annual ? 'ก' : ''}</h2>
        <div className="form-row"><span>ชื่อผู้มีหน้าที่หักภาษี ณ ที่จ่าย <b>{p.payer.name}</b></span><span>เลขประจำตัวผู้เสียภาษีอากร <b>{formatTaxId(p.payer.tax_id)}</b></span><span>สาขาที่ <b>{p.payer.branch_no}</b></span>
          <span>{annual ? <>ปีภาษี <b>{be(p.year!)}</b></> : <>เดือนที่จ่ายเงินได้ <b>{monthLabel(p.month!)}</b></>}</span><span>แผ่นที่ {pi + 1} / {pages.length}</span></div>
      </div>
      <table><thead><tr><th className="c">ลำดับ</th><th>เลขประจำตัวผู้เสียภาษีอากร</th><th>ชื่อผู้มีเงินได้</th>{annual ? <th>ที่อยู่ของผู้มีเงินได้</th> : <th className="c">วัน เดือน ปี ที่จ่าย</th>}
        <th className="r">จำนวนเงินได้ที่จ่าย{annual ? 'ทั้งปี' : 'ในครั้งนี้'}</th><th className="r">จำนวนเงินภาษีที่หักและนำส่ง{annual ? 'ทั้งปี' : 'ในครั้งนี้'}</th><th className="c">เงื่อนไข</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.employee_id}><td className="c">{r.no}</td><td>{formatTaxId(r.tax_id)}</td><td>{nameOf(r)}</td>{annual ? <td>{r.address}</td> : <td className="c">{dmy(r.pay_date)}</td>}
          <td className="r">{fmt(r.income)}</td><td className="r">{fmt(r.tax)}</td><td className="c">{r.condition}</td></tr>)}</tbody>
        {pi === pages.length - 1 && <tfoot><tr><th colSpan={4} className="r">รวมทั้งสิ้น {p.count} ราย ({bahtText(p.tax)})</th><th className="r">{fmt(p.income)}</th><th className="r">{fmt(p.tax)}</th><th /></tr></tfoot>}
      </table>
      <p className="small">เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว · เงินได้ตามมาตรา 40(1) เงินเดือน ค่าจ้าง ฯลฯ กรณีทั่วไป</p>
      <p style={{ textAlign: 'right', marginTop: '8mm' }}>ลงชื่อ .................................................... ผู้จ่ายเงิน<br />(....................................................)<br />ตำแหน่ง .................................... ยื่นวันที่ ......../......../........</p>
    </div>))}</>;
}
function SsoPrint({ s, month }: { s: Sso; month: string }) {
  const pages = chunk(s.rows, 22);
  return <>{pages.map((rows, pi) => (
    <div className="page" key={pi}>
      {pi === 0 && <div className="form-box">
        <h2>แบบรายการแสดงการส่งเงินสมทบ (สปส.1-10) ส่วนที่ 1</h2>
        <div className="form-row"><span>ชื่อสถานประกอบการ <b>{s.payer.name}</b></span><span>เลขที่บัญชี <b>{s.payer.sso_employer_no || '..........'}</b></span><span>ลำดับที่สาขา <b>{s.payer.sso_branch_no}</b></span></div>
        <div className="form-row"><span>เงินสมทบสำหรับค่าจ้างเดือน <b>{monthLabel(month)}</b></span><span>อัตราเงินสมทบร้อยละ <b>{s.employee_rate}</b></span></div>
        <table><tbody>
          <tr><td>1. ค่าจ้างทั้งสิ้น</td><td className="r">{fmt(s.wage)}</td></tr>
          <tr><td>2. เงินสมทบผู้ประกันตน</td><td className="r">{fmt(s.ee)}</td></tr>
          <tr><td>3. เงินสมทบนายจ้าง</td><td className="r">{fmt(s.er)}</td></tr>
          <tr><td><b>4. รวมเงินสมทบที่นำส่งทั้งสิ้น</b> ({bahtText(s.total)})</td><td className="r"><b>{fmt(s.total)}</b></td></tr>
          <tr><td>5. จำนวนผู้ประกันตนที่ส่งเงินสมทบ</td><td className="r">{s.count} คน</td></tr>
        </tbody></table>
      </div>}
      <h3 style={{ margin: '2mm 0' }}>ส่วนที่ 2 รายละเอียดการนำส่งเงินสมทบ {pages.length > 1 ? `(แผ่นที่ ${pi + 1}/${pages.length})` : ''}</h3>
      <table><thead><tr><th className="c">ลำดับที่</th><th>เลขประจำตัวประชาชน</th><th>คำนำหน้านาม - ชื่อ - ชื่อสกุล</th><th className="r">ค่าจ้างที่จ่ายจริง</th><th className="r">เงินสมทบผู้ประกันตน</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.code}><td className="c">{r.no}</td><td>{formatTaxId(r.tax_id)}</td><td>{nameOf(r)}</td><td className="r">{fmt(r.wage)}</td><td className="r">{fmt(r.ee)}</td></tr>)}</tbody>
        {pi === pages.length - 1 && <tfoot><tr><th colSpan={3} className="r">รวม</th><th className="r">{fmt(s.wage)}</th><th className="r">{fmt(s.ee)}</th></tr></tfoot>}
      </table>
      {pi === pages.length - 1 && <p style={{ textAlign: 'right', marginTop: '8mm' }}>ลงชื่อ .................................................... นายจ้าง/ผู้รับมอบอำนาจ<br />(....................................................)<br />ยื่นวันที่ ......../......../........</p>}
    </div>))}</>;
}

const thisMonth = () => todayIso().slice(0, 7);
/** ภาษีและประกันสังคม: ภ.ง.ด.1 รายเดือน · ภ.ง.ด.1ก ประจำปี · 50 ทวิ ประจำปี · สปส.1-10 */
export function PayTaxPage() {
  const qc = useQueryClient();
  const can = useCan('PAY.TAX');
  const { me } = useSession();
  const [tab, setTab] = useState('pnd1');
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [branch, setBranch] = useState('');
  const [taxedOnly, setTaxedOnly] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { portal, print } = usePrintJob();
  const pnd1 = useQuery({ enabled: tab === 'pnd1', queryKey: ['pay-pnd1', month, branch, taxedOnly], queryFn: () => api.get<Pnd>('/api/v1/pay/pnd1', { month, branch_id: branch, taxed_only: taxedOnly ? '1' : '0' }) });
  const pnd1a = useQuery({ enabled: tab === 'pnd1a', queryKey: ['pay-pnd1a', year, branch], queryFn: () => api.get<Pnd>('/api/v1/pay/pnd1a', { year, branch_id: branch }) });
  const w50 = useQuery({ enabled: tab === 'w50', queryKey: ['pay-w50', year], queryFn: () => api.get<W50>('/api/v1/pay/w50', { year }) });
  const sso = useQuery({ enabled: tab === 'sso', queryKey: ['pay-sso', month, branch], queryFn: () => api.get<Sso>('/api/v1/pay/sso', { month, branch_id: branch }) });
  const cur = tab === 'pnd1' ? pnd1 : tab === 'pnd1a' ? pnd1a : tab === 'w50' ? w50 : sso;
  const drafts = (cur.data as { drafts?: number } | undefined)?.drafts ?? 0;
  const problems = ((cur.data as { rows?: Array<{ code: string; problem: string | null }> } | undefined)?.rows ?? []).filter((r) => r.problem);
  const issue = async () => {
    try { const r = await api.post<{ issued: number }>('/api/v1/pay/w50/issue', { year }); toast(r.issued ? `ออกเลขที่หนังสือรับรอง ${r.issued} ฉบับแล้ว` : 'ทุกคนมีเลขที่แล้ว'); qc.invalidateQueries({ queryKey: ['pay-w50'] }); }
    catch (e) { toastError(e); }
  };
  const printW50 = (copies: Array<1 | 2>) => {
    const rows = (w50.data?.rows ?? []).filter((r) => sel.has(r.employee_id) && r.issued);
    if (!rows.length) { toast('เลือกพนักงานที่ออกเลขที่แล้ว', 'warn'); return; }
    print(<>{rows.flatMap((r) => copies.map((c) => <Wht50Sheet key={`${r.employee_id}-${c}`} data={{ ...r.data, copy: c }} />))}</>, { w50: true,
      done: () => { api.post('/api/v1/pay/w50/printed', { year, employee_ids: rows.map((r) => r.employee_id) }).then(() => qc.invalidateQueries({ queryKey: ['pay-w50'] })).catch(() => undefined); } });
  };
  const doPrint = () => {
    if (tab === 'pnd1' && pnd1.data) print(<PndPrint p={{ ...pnd1.data, month }} annual={false} />, { land: true });
    if (tab === 'pnd1a' && pnd1a.data) print(<PndPrint p={{ ...pnd1a.data, year }} annual />, { land: true });
    if (tab === 'sso' && sso.data) print(<SsoPrint s={sso.data} month={month} />);
    if (tab === 'w50') printW50([1, 2]);
  };
  useHotkeys({ 'Ctrl+P': doPrint }, []);
  const exportXls = () => {
    if ((tab === 'pnd1' || tab === 'pnd1a') && cur.data) { const p = cur.data as Pnd;
      downloadXls(tab === 'pnd1' ? `ภงด1_${month}` : `ภงด1ก_${be(year)}`, [p.payer.name, tab === 'pnd1' ? `ภ.ง.ด.1 ${monthLabel(month)}` : `ภ.ง.ด.1ก ปี ${be(year)}`], ['ลำดับ', 'เลขประจำตัวผู้เสียภาษี', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', tab === 'pnd1' ? 'วันที่จ่าย' : 'ที่อยู่', 'เงินได้', 'ภาษี', 'เงื่อนไข'],
        p.rows.map((r) => [r.no, r.tax_id ?? '', r.title ?? '', r.first_name, r.last_name ?? '', tab === 'pnd1' ? dmy(r.pay_date) : r.address ?? '', r.income, r.tax, r.condition])); }
    if (tab === 'sso' && sso.data) downloadXls(`สปส1-10_${month}`, [sso.data.payer.name, `สปส.1-10 ${monthLabel(month)}`], ['ลำดับ', 'เลขประจำตัวประชาชน', 'คำนำหน้า', 'ชื่อ', 'สกุล', 'ค่าจ้างที่จ่ายจริง', 'ค่าจ้างที่ใช้คำนวณ', 'เงินสมทบ'],
      sso.data.rows.map((r) => [r.no, r.tax_id ?? '', r.title ?? '', r.first_name, r.last_name ?? '', r.wage_paid, r.wage, r.ee]));
  };
  const monthPick = <label>เดือนที่จ่าย <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="เดือน" /> <span className="muted">({monthLabel(month)})</span></label>;
  const yearPick = <label>ปีภาษี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-2, -1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{be(y)}</option>; })}</select></label>;
  const branchPick = (me?.branches.length ?? 0) > 1 && <label>สาขาที่ยื่น <select value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">ทุกสาขารวมกัน</option>{me!.branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name} ({b.tax_branch_no})</option>)}</select></label>;
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="เงินเดือน" title="ภาษีและประกันสังคม" lead="แบบ ภ.ง.ด.1 รายเดือน · ภ.ง.ด.1ก ประจำปี · หนังสือรับรอง 50 ทวิ ประจำปี · สปส.1-10 — ยอดจากรอบเงินเดือนที่บันทึกแล้ว (รอบร่างไม่นับ) · เดือนภาษี = เดือนที่จ่าย" />
      <Tabs active={tab} onChange={(t) => { setTab(t); setSel(new Set()); }} tabs={[{ key: 'pnd1', label: 'ภ.ง.ด.1 รายเดือน' }, { key: 'sso', label: 'สปส.1-10' }, { key: 'pnd1a', label: 'ภ.ง.ด.1ก ประจำปี' }, { key: 'w50', label: '50 ทวิ ประจำปี' }]} />
      <div className="toolbar">
        {tab === 'pnd1' || tab === 'sso' ? monthPick : yearPick}
        {tab !== 'w50' && branchPick}
        {tab === 'pnd1' && <label className="check"><input type="checkbox" checked={taxedOnly} onChange={(e) => setTaxedOnly(e.target.checked)} /> เฉพาะคนที่ถูกหักภาษี</label>}
        {tab === 'w50' && <button className="primary" disabled={!can('add')} onClick={issue} title="ออกเลขที่ให้พนักงานที่ยังไม่มี — เลขที่ออกแล้วไม่เปลี่ยน">ออกเลขที่หนังสือรับรอง</button>}
        <button className={tab === 'w50' ? undefined : 'primary'} disabled={!can('print') || !cur.data} onClick={doPrint}>🖨 พิมพ์ <kbd>Ctrl+P</kbd></button>
        {tab === 'w50' && <><button disabled={!can('print')} onClick={() => printW50([1])}>พิมพ์ฉบับที่ 1</button><button disabled={!can('print')} onClick={() => printW50([2])}>ฉบับที่ 2</button></>}
        {tab !== 'w50' && <button disabled={!cur.data} onClick={exportXls}>ส่งออก Excel</button>}
      </div>
      <ErrorBox error={cur.error} />
      {drafts > 0 && <div className="note-box warn">มีรอบเงินเดือนร่าง {drafts} รอบในช่วงนี้ที่ยังไม่บันทึก — ไม่นับในแบบนี้</div>}
      {!!problems.length && <div className="note-box warn"><b>ต้องแก้ก่อนยื่น:</b><ul className="small">{problems.map((r) => <li key={r.code}>{r.code}: {r.problem}</li>)}</ul></div>}
      {(tab === 'pnd1' || tab === 'pnd1a') && cur.data && (() => { const p = cur.data as Pnd; return (
        <div className="table-wrap tall"><table className="grid">
          <thead><tr><th style={{ width: 50 }}>ลำดับ</th><th style={{ width: 150 }}>เลขประจำตัวผู้เสียภาษี</th><th>ชื่อผู้มีเงินได้</th><th>{tab === 'pnd1' ? 'วันที่จ่าย' : 'ที่อยู่'}</th><th className="r">เงินได้</th><th className="r">ภาษี</th><th>เงื่อนไข</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.employee_id} className={cx(r.problem && 'warn-row')}><td>{r.no}</td><td className="mono">{formatTaxId(r.tax_id)}</td><td><span className="mono muted">{r.code}</span> {nameOf(r)}</td>
            <td className="small">{tab === 'pnd1' ? <DateText v={r.pay_date} /> : r.address}</td><td className="r"><Money v={r.income} /></td><td className="r"><Money v={r.tax} /></td><td className="small">{r.condition} {COND[r.condition]}</td></tr>)}
            {!p.rows.length && <tr><td colSpan={7} className="empty">ไม่มีเงินได้ในช่วงนี้ (หรือรอบเงินเดือนยังเป็นร่าง)</td></tr>}</tbody>
          <tfoot><tr><td colSpan={4}>รวม {p.count} ราย</td><td className="r"><Money v={p.income} /></td><td className="r"><Money v={p.tax} /></td><td /></tr></tfoot>
        </table></div>); })()}
      {tab === 'sso' && sso.data && <div className="table-wrap tall"><table className="grid">
        <thead><tr><th style={{ width: 50 }}>ลำดับ</th><th style={{ width: 150 }}>เลขประจำตัวประชาชน</th><th>ชื่อ</th><th className="r">ค่าจ้างที่จ่ายจริง</th><th className="r">ค่าจ้างที่ใช้คำนวณ</th><th className="r">ลูกจ้าง</th><th className="r">นายจ้าง</th></tr></thead>
        <tbody>{sso.data.rows.map((r) => <tr key={r.code}><td>{r.no}</td><td className="mono">{formatTaxId(r.tax_id)}</td><td><span className="mono muted">{r.code}</span> {nameOf(r)}</td><td className="r"><Money v={r.wage_paid} /></td><td className="r"><Money v={r.wage} /></td><td className="r"><Money v={r.ee} /></td><td className="r"><Money v={r.er} /></td></tr>)}
          {!sso.data.rows.length && <tr><td colSpan={7} className="empty">ไม่มีเงินสมทบในเดือนนี้</td></tr>}</tbody>
        <tfoot><tr><td colSpan={3}>รวม {sso.data.count} คน · เลขที่บัญชีนายจ้าง {sso.data.payer.sso_employer_no || <Pill tone="c">ยังไม่ได้ตั้ง (ตั้งค่าระบบเงินเดือน ข้อ 1)</Pill>}</td><td className="r"><Money v={sso.data.wage_paid} /></td><td className="r"><Money v={sso.data.wage} /></td><td className="r"><Money v={sso.data.ee} /></td><td className="r"><Money v={sso.data.er} /></td></tr>
          <tr><td colSpan={5} className="r"><b>รวมเงินสมทบนำส่ง</b></td><td colSpan={2} className="r"><b><Money v={sso.data.total} /></b></td></tr></tfoot>
      </table></div>}
      {tab === 'w50' && w50.data && <div className="table-wrap tall"><table className="grid">
        <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="เลือกทั้งหมด" checked={!!w50.data.rows.length && sel.size === w50.data.rows.length} onChange={(e) => setSel(e.target.checked ? new Set(w50.data!.rows.map((r) => r.employee_id)) : new Set())} /></th>
          <th style={{ width: 110 }}>เล่มที่/เลขที่</th><th>ชื่อ</th><th className="r">เงินได้ทั้งปี</th><th className="r">ภาษีที่หัก</th><th className="r">ประกันสังคม</th><th className="r">กองทุนสำรองฯ</th><th>วันที่ออก</th><th>พิมพ์</th></tr></thead>
        <tbody>{w50.data.rows.map((r) => <tr key={r.employee_id} className="row-open" onClick={() => setSel((s) => { const n = new Set(s); if (n.has(r.employee_id)) n.delete(r.employee_id); else n.add(r.employee_id); return n; })}>
          <td className="c"><input type="checkbox" readOnly checked={sel.has(r.employee_id)} aria-label={r.code} /></td><td className="mono">{r.issued ? `${r.data.book_no}/${r.data.run_no}` : <Pill tone="c">ยังไม่ออก</Pill>}</td>
          <td><span className="mono muted">{r.code}</span> {r.name}</td><td className="r"><Money v={r.income} /></td><td className="r"><Money v={r.tax} /></td><td className="r"><Money v={r.sso} blankZero /></td><td className="r"><Money v={r.pvd} blankZero /></td>
          <td><DateText v={r.data.issue_date} /></td><td>{r.print_count ? `${r.print_count} ครั้ง` : ''}</td></tr>)}
          {!w50.data.rows.length && <tr><td colSpan={9} className="empty">ไม่มีเงินได้ในปีนี้</td></tr>}</tbody>
      </table></div>}
      <KeyHints keys={[['Ctrl+P', 'พิมพ์']]} />
      {portal}
    </div>
  );
}

// ---------------------------------------------------------------- รายงานเงินเดือน
interface Reg { columns: Array<{ key: string; code: string; label: string; kind: string }>; rows: Array<{ code: string; name: string; department: string | null; values: Record<string, string | null>; gross: string; tax: string; sso_ee: string; pvd_ee: string; other: string; net: string; sso_er: string; pvd_er: string }>; drafts: number }
interface Yearly { rows: Array<{ code: string; name: string; months: string[]; total: string }>; months: string[] }
interface Cost { rows: Array<{ department: string; headcount: number; gross: string; sso_er: string; pvd_er: string; borne: string; total: string }>; total: Record<string, string> }
const MEASURE: Record<string, string> = { gross: 'รวมเงินได้', tax: 'ภาษีหัก ณ ที่จ่าย', sso_ee: 'ประกันสังคม (ลูกจ้าง)', net_pay: 'จ่ายสุทธิ' };
/** รายงานเงินเดือน: ทะเบียนเงินเดือนรายเดือน · สรุป 12 เดือน · ค่าใช้จ่ายพนักงานตามแผนก */
export function PayReportsPage() {
  const [tab, setTab] = useState('reg');
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [measure, setMeasure] = useState('gross');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01`);
  const [to, setTo] = useState(thisMonth());
  const { portal, print } = usePrintJob();
  const reg = useQuery({ enabled: tab === 'reg', queryKey: ['pay-reg', month], queryFn: () => api.get<Reg>('/api/v1/pay/reports/register', { month }) });
  const yr = useQuery({ enabled: tab === 'year', queryKey: ['pay-yr', year, measure], queryFn: () => api.get<Yearly>('/api/v1/pay/reports/yearly', { year, measure }) });
  const cost = useQuery({ enabled: tab === 'cost', queryKey: ['pay-cost', from, to], queryFn: () => api.get<Cost>('/api/v1/pay/reports/cost', { from, to }) });
  const cur = tab === 'reg' ? reg : tab === 'year' ? yr : cost;
  const table = (): { title: string; head: string[]; rows: Array<Array<string | number | null>>; foot?: Array<string | number | null> } | null => {
    if (tab === 'reg' && reg.data) { const r = reg.data;
      return { title: `ทะเบียนเงินเดือน ${monthLabel(month)}`, head: ['รหัส', 'ชื่อ', 'แผนก', ...r.columns.map((c) => c.label), 'รวมเงินได้', 'จ่ายสุทธิ', 'ประกันสังคมนายจ้าง'],
        rows: r.rows.map((x) => [x.code, x.name, x.department, ...r.columns.map((c) => x.values[c.key] ?? null), x.gross, x.net, x.sso_er]),
        foot: ['รวม', `${r.rows.length} คน`, '', ...r.columns.map((c) => r.rows.reduce((s, x) => s.plus(x.values[c.key] ?? 0), d(0)).toFixed(2)), r.rows.reduce((s, x) => s.plus(x.gross), d(0)).toFixed(2), r.rows.reduce((s, x) => s.plus(x.net), d(0)).toFixed(2), r.rows.reduce((s, x) => s.plus(x.sso_er), d(0)).toFixed(2)] }; }
    if (tab === 'year' && yr.data) return { title: `สรุป${MEASURE[measure]} 12 เดือน ปี ${be(year)}`, head: ['รหัส', 'ชื่อ', ...MONTH_TH_SHORT, 'รวม'], rows: yr.data.rows.map((x) => [x.code, x.name, ...x.months, x.total]),
      foot: ['รวม', '', ...yr.data.months, yr.data.months.reduce((s, v) => s.plus(v), d(0)).toFixed(2)] };
    if (tab === 'cost' && cost.data) return { title: `ค่าใช้จ่ายพนักงานตามแผนก ${monthLabel(from)} – ${monthLabel(to)}`, head: ['แผนก', 'จำนวนคน', 'เงินได้', 'ประกันสังคมนายจ้าง', 'กองทุนสำรองฯ นายจ้าง', 'ภาษีที่บริษัทออกให้', 'รวมค่าใช้จ่าย'],
      rows: cost.data.rows.map((x) => [x.department, x.headcount, x.gross, x.sso_er, x.pvd_er, x.borne, x.total]), foot: ['รวม', '', cost.data.total.gross!, cost.data.total.sso_er!, cost.data.total.pvd_er!, cost.data.total.borne!, cost.data.total.total!] };
    return null;
  };
  const t = table();
  const isNum = (v: unknown) => typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v);
  const cell = (v: string | number | null, i: number) => <td key={i} className={isNum(v) || typeof v === 'number' ? 'r' : undefined}>{isNum(v) ? fmt(v as string, { blankZero: true }) : v}</td>;
  const doPrint = () => t && print(<div><h3 style={{ textAlign: 'center', margin: '0 0 3mm' }}>{t.title}</h3><table><thead><tr>{t.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map(cell)}</tr>)}</tbody>{t.foot && <tfoot><tr>{t.foot.map(cell)}</tr></tfoot>}</table></div>, { land: t.head.length > 8 });
  useHotkeys({ 'Ctrl+P': doPrint }, []);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="เงินเดือน" title="รายงานเงินเดือน" lead="ยอดจากรอบเงินเดือนที่บันทึกแล้ว (รอบร่างไม่นับ)" />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'reg', label: 'ทะเบียนเงินเดือนรายเดือน' }, { key: 'year', label: 'สรุป 12 เดือน' }, { key: 'cost', label: 'ค่าใช้จ่ายตามแผนก' }]} />
      <div className="toolbar">
        {tab === 'reg' && <label>เดือน <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="เดือน" /> <span className="muted">({monthLabel(month)})</span></label>}
        {tab === 'year' && <><label>ปี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-2, -1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{be(y)}</option>; })}</select></label>
          <label>แสดง <select value={measure} onChange={(e) => setMeasure(e.target.value)}>{Object.entries(MEASURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></>}
        {tab === 'cost' && <><label>ตั้งแต่ <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ตั้งแต่เดือน" /></label><label>ถึง <input type="month" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึงเดือน" /></label></>}
        <button className="primary" disabled={!t} onClick={doPrint}>🖨 พิมพ์ <kbd>Ctrl+P</kbd></button>
        <button disabled={!t} onClick={() => t && downloadXls(t.title.replace(/\s+/g, '_'), [t.title], t.head, [...t.rows, ...(t.foot ? [t.foot] : [])])}>ส่งออก Excel</button>
      </div>
      <ErrorBox error={cur.error} />
      {tab === 'reg' && !!reg.data?.drafts && <div className="note-box warn">มีรอบเงินเดือนร่าง {reg.data.drafts} รอบในเดือนนี้ที่ยังไม่บันทึก — ไม่นับในรายงาน</div>}
      {t && <div className="table-wrap tall"><table className="grid">
        <thead><tr>{t.head.map((h) => <th key={h} className={h === 'รหัส' || h === 'ชื่อ' || h === 'แผนก' ? undefined : 'r'}>{h}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map(cell)}</tr>)}{!t.rows.length && <tr><td colSpan={t.head.length} className="empty">ไม่มีข้อมูลในช่วงนี้</td></tr>}</tbody>
        {t.foot && !!t.rows.length && <tfoot><tr>{t.foot.map(cell)}</tr></tfoot>}
      </table></div>}
      <KeyHints keys={[['Ctrl+P', 'พิมพ์']]} />
      {portal}
    </div>
  );
}
