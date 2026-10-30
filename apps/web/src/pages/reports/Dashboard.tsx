import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, d, fmt, formatDate, MONTH_TH_SHORT, todayIso, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { useLookups, LkSelect } from '../../components/LkSelect';
import { cx, DateInput, ErrorBox, PageHead } from '../../ui';

/**
 * แดชบอร์ดผู้บริหาร (RP.DASH) — สรุปสดจาก GET /api/v1/dashboard
 * คลิกช่วงเวลาบนกราฟยอดขาย / รายได้-ค่าใช้จ่าย → การ์ดสรุป สินค้าขายดี และอายุหนี้ เปลี่ยนเป็นข้อมูลของช่วงนั้น
 * กราฟวาดด้วย SVG ของหน้าเอง (ไม่ใช้ไลบรารีเพิ่ม) · สีตามธีมของบริษัท
 */
type Money = string | null;
interface Kpi { sales: Money; ar: Money; ap: Money; cash_in: Money; cash_out: Money; cash_net: Money; cash_vouchers: number; deposit_ar: Money; deposit_ap: Money; revenue: Money; expense: Money; profit: Money; margin: string | null }
interface Dash {
  range: { from: string; to: string }; prev: { from: string; to: string }; ly: { from: string; to: string }; grain: Grain;
  kpis: { current: Kpi; prev: Kpi; ly: Kpi };
  trend: Array<{ key: string; from: string; to: string; sales: string; docs: number; sales_ly: Money }>;
  top_items: Array<{ id: string; code: string; name: string; qty: string; amount: string }>;
  categories: Array<{ code: string | null; name: string; amount: string }>;
  aging: { buckets: string[]; as_of: string; ar: string[]; ap: string[] };
  pl: Array<{ month: string; revenue: string; expense: string; profit: string }>;
}
type Grain = 'day' | 'month' | 'quarter';
type Preset = 'month' | 'quarter' | 'year' | 'last-year' | 'custom';
type Range = { from: string; to: string };

const AGING_COLORS = ['#8ccfa9', '#f1d67e', '#f2b27a', '#e99393', '#c9607a'];
const C_SALES = 'var(--tone)', C_LY = '#b9b2d6', C_REV = '#4fa97a', C_EXP = '#e09a6a', C_PROFIT = '#5866c4';

function presetRange(p: Preset, base: string): Range {
  const y = base.slice(0, 4), m = Number(base.slice(5, 7));
  if (p === 'month') return { from: `${base.slice(0, 7)}-01`, to: addDays(addMonths(`${base.slice(0, 7)}-01`, 1), -1) };
  if (p === 'quarter') { const q0 = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`; return { from: q0, to: addDays(addMonths(q0, 3), -1) }; }
  if (p === 'last-year') { const ly = String(Number(y) - 1); return { from: `${ly}-01-01`, to: `${ly}-12-31` }; }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
const yy = (iso: string, ys: YearSystem) => String(Number(iso.slice(0, 4)) + (ys === 'B' ? 543 : 0));
function bucketLabel(key: string, grain: Grain, ys: YearSystem, short = false) {
  const m = Number(key.slice(5, 7));
  if (grain === 'day') return short ? String(Number(key.slice(8, 10))) : formatDate(key, ys);
  if (grain === 'quarter') return `ไตรมาส ${Math.floor((m - 1) / 3) + 1}${short ? '' : ` ${yy(key, ys)}`}`;
  return short ? MONTH_TH_SHORT[m - 1]! : `${MONTH_TH_SHORT[m - 1]} ${yy(key, ys)}`;
}
/** ตัวเลขย่อบนแกน: 1.2 ล้าน / 350 พัน */
function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)} ล้าน`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} พัน`;
  return v.toFixed(0);
}
/** ขอบบนของแกนที่อ่านง่าย (1, 2, 2.5, 5 × 10^n) */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= v) ?? v;
}
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e!.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const num = (x: Money) => Number(x ?? 0);   // ใช้วาดกราฟเท่านั้น — ตัวเลขที่แสดงใช้ fmt() จากข้อความทศนิยม

export function DashboardPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  const base = me?.work_date ?? todayIso();
  const [preset, setPreset] = useState<Preset>((sp.get('p') as Preset) || 'year');
  const [custom, setCustom] = useState<Range>(() => presetRange('month', base));
  const range = preset === 'custom' ? custom : presetRange(preset, base);
  const [grain, setGrain] = useState<Grain>((sp.get('grain') as Grain) || 'month');
  const [cat, setCat] = useState(sp.get('cat') ?? '');
  const [ctype, setCtype] = useState(sp.get('ctype') ?? '');
  const [cmp, setCmp] = useState<'prev' | 'ly'>('prev');
  const [focus, setFocus] = useState<{ from: string; to: string; label: string } | null>(null);
  const [byCat, setByCat] = useState(false);
  const lk = useLookups('22,45');
  useEffect(() => { setFocus(null); }, [range.from, range.to, grain, cat, ctype, me?.branch?.id]);
  useEffect(() => { setSp({ p: preset, grain, ...(cat ? { cat } : {}), ...(ctype ? { ctype } : {}) }, { replace: true }); }, [preset, grain, cat, ctype, setSp]);
  const effGrain: Grain = grain === 'day' && Date.parse(range.to) - Date.parse(range.from) > 91 * 86400000 ? 'month' : grain;
  const params = (r: Range, g: Grain) => ({ from: r.from, to: r.to, grain: g, branch_id: me?.branch?.id, category: cat || undefined, customer_type: ctype || undefined });
  const all = useQuery({ queryKey: ['dashboard', params(range, effGrain)], queryFn: () => api.get<Dash>('/api/v1/dashboard', params(range, effGrain)) });
  const sub = useQuery({ enabled: !!focus, queryKey: ['dashboard', focus && params(focus, 'month')], queryFn: () => api.get<Dash>('/api/v1/dashboard', params(focus!, 'month')) });
  const D = all.data, F = focus ? sub.data : all.data;
  const pick = (from: string, to: string, label: string) => setFocus((f) => (f && f.from === from && f.to === to ? null : { from, to, label }));
  const drill = (path: string) => nav(path);
  const rangeText = `${formatDate(range.from, ys)} – ${formatDate(range.to, ys)}`;

  return (
    <div className="page dash" data-tone="reports">
      <PageHead eyebrow="รายงาน › แดชบอร์ดผู้บริหาร" title="แดชบอร์ดผู้บริหาร"
        lead={<>ข้อมูลสดจากเอกสารขาย ซื้อ รับ/จ่ายชำระ และใบสำคัญ · {me?.company?.name_th} · {me?.branch ? `สาขา ${me.branch.name}` : 'ทุกสาขา'} (เปลี่ยนบริษัท/สาขาที่แถบด้านบน)</>} />
      <section className="dash-filters card no-print" aria-label="ตัวกรอง">
        <div className="seg" role="group" aria-label="ช่วงเวลา">
          {([['month', 'เดือนนี้'], ['quarter', 'ไตรมาสนี้'], ['year', 'ปีนี้'], ['last-year', 'ปีที่แล้ว'], ['custom', 'กำหนดเอง']] as const).map(([k, t]) =>
            <button key={k} className={cx(preset === k && 'on')} onClick={() => setPreset(k)}>{t}</button>)}
        </div>
        {preset === 'custom' && <span className="inline">ตั้งแต่ <DateInput value={custom.from} onChange={(v) => setCustom((c) => ({ from: v, to: c.to < v ? v : c.to }))} /> ถึง <DateInput value={custom.to} onChange={(v) => setCustom((c) => ({ from: c.from > v ? v : c.from, to: v }))} /></span>}
        <div className="seg" role="group" aria-label="แสดงยอดขาย">
          {([['day', 'รายวัน'], ['month', 'รายเดือน'], ['quarter', 'รายไตรมาส']] as const).map(([k, t]) =>
            <button key={k} className={cx(grain === k && 'on')} onClick={() => setGrain(k)} title={k === 'day' ? 'รายวันดูได้ไม่เกิน 92 วัน (เกินกว่านั้นแสดงรายเดือน)' : undefined}>{t}</button>)}
        </div>
        <label className="inline">หมวดสินค้า <LkSelect rows={lk.data?.['22']} value={cat} onChange={setCat} blank="ทุกหมวด" aria-label="หมวดสินค้า" /></label>
        <label className="inline">ประเภทลูกค้า <LkSelect rows={lk.data?.['45']} value={ctype} onChange={setCtype} blank="ทุกประเภท" aria-label="ประเภทลูกค้า" /></label>
        <label className="inline">เทียบกับ <select value={cmp} onChange={(e) => setCmp(e.target.value as 'prev' | 'ly')}><option value="prev">ช่วงก่อนหน้า</option><option value="ly">ช่วงเดียวกันปีที่แล้ว</option></select></label>
      </section>
      <div className="dash-scope">
        <span>ช่วงที่ดู: <b>{rangeText}</b></span>
        {focus && <button className="chip" onClick={() => setFocus(null)} title="กลับไปดูทั้งช่วง">เจาะดู: {focus.label} ✕</button>}
        {(cat || ctype) && <span className="muted">กรองหมวดสินค้า/ประเภทลูกค้า: มีผลกับยอดขาย สินค้าขายดี{ctype ? ' และลูกหนี้' : ''} (กำไร เงินสด เจ้าหนี้ เป็นยอดทั้งบริษัท)</span>}
      </div>
      <ErrorBox error={all.error ?? sub.error} />

      <Kpis k={F?.kpis} cmp={cmp} focus={!!focus} onGo={drill} />

      <div className="dash-grid">
        <Panel title="ยอดขายตามช่วงเวลา" wide hint="คลิกแท่งเพื่อเจาะดูช่วงนั้น · เส้นจาง = ช่วงเดียวกันปีที่แล้ว">
          {D && <SalesTrend data={D} ys={ys} focus={focus} onPick={(t) => pick(t.from, t.to, bucketLabel(t.key, D.grain, ys))} />}
        </Panel>
        <Panel title={byCat ? 'ยอดขายตามหมวดสินค้า' : 'สินค้าขายดี 10 อันดับ'} hint="ยอดก่อน VAT หลังหักส่วนลดแล้ว (หักใบลดหนี้)"
          actions={<div className="seg sm"><button className={cx(!byCat && 'on')} onClick={() => setByCat(false)}>ตามสินค้า</button><button className={cx(byCat && 'on')} onClick={() => setByCat(true)}>ตามหมวด</button></div>}>
          {F && (byCat
            ? <HBars rows={F.categories.map((c) => ({ key: c.code ?? '', label: c.name, sub: c.code ?? '', amount: c.amount }))} onPick={(r) => r.key && setCat(r.key === cat ? '' : r.key)} pickHint="คลิกเพื่อกรองหมวดนี้" active={cat} />
            : <HBars rows={F.top_items.map((t) => ({ key: t.id, label: t.name, sub: `${t.code} · ${fmt(t.qty, { places: 0 })} หน่วย`, amount: t.amount }))} />)}
        </Panel>
        <Panel title="อายุลูกหนี้และเจ้าหนี้" hint={F ? `ยอดคงค้าง ณ ${formatDate(F.aging.as_of, ys)} · คลิกเพื่อเปิดรายงานวิเคราะห์อายุหนี้` : ''}>
          {F && <Aging data={F} onGo={drill} />}
        </Panel>
        <Panel title="รายได้เทียบค่าใช้จ่าย" wide hint="จากบัญชีหมวด 4 และหมวด 5 รายเดือน · คลิกเดือนเพื่อเจาะดู">
          {D && <RevExp data={D} ys={ys} focus={focus} onPick={(m, from, to) => pick(from, to, `${MONTH_TH_SHORT[Number(m.slice(5, 7)) - 1]} ${yy(m, ys)}`)} />}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, hint, wide, actions, children }: { title: string; hint?: string; wide?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={cx('card dash-panel', wide && 'wide')}>
      <div className="dash-panel-head"><h2>{title}</h2>{actions}</div>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Delta({ cur, base, good }: { cur: Money; base: Money; good: 'up' | 'down' | 'none' }) {
  if (cur === null || base === null || d(base).isZero()) return <span className="delta muted">— ไม่มีข้อมูลเทียบ</span>;
  const pct = d(cur).minus(base).times(100).div(d(base).abs());
  const up = pct.gt(0);
  const tone = pct.abs().lt('0.05') || good === 'none' ? '' : (up === (good === 'up') ? 'ok' : 'bad');
  return <span className={cx('delta', tone)}>{pct.abs().lt('0.05') ? '■ 0.0%' : `${up ? '▲' : '▼'} ${pct.abs().toFixed(1)}%`}</span>;
}

function Kpis({ k, cmp, focus, onGo }: { k?: Dash['kpis']; cmp: 'prev' | 'ly'; focus: boolean; onGo: (p: string) => void }) {
  const c = k?.current, b = k?.[cmp];
  const show = (x: Money | undefined) => (k ? (x === null || x === undefined ? '—' : fmt(x)) : '…');
  const vs = cmp === 'prev' ? 'เทียบช่วงก่อนหน้า' : 'เทียบปีที่แล้ว';
  return (
    <div className="kpis dash-kpis">
      <button className="kpi" data-tone="sales" onClick={() => onGo('/reports/center?g=1')}>
        <span>ยอดขาย (ก่อน VAT)</span><b className="num">{show(c?.sales)}</b>
        {c && b && <small><Delta cur={c.sales} base={b.sales} good="up" /> {vs}</small>}
      </button>
      <button className="kpi" data-tone="finance" onClick={() => onGo('/reports/center?g=1.C')}>
        <span>ลูกหนี้การค้าคงเหลือ {focus ? '(ณ สิ้นช่วงที่เจาะดู)' : '(ณ สิ้นช่วง)'}</span><b className="num">{show(c?.ar)}</b>
        {c && b && <small><Delta cur={c.ar} base={b.ar} good="down" /> {vs}</small>}
      </button>
      <button className="kpi" data-tone="purchase" onClick={() => onGo('/reports/center?g=2.C')}>
        <span>เจ้าหนี้การค้าคงเหลือ {focus ? '(ณ สิ้นช่วงที่เจาะดู)' : '(ณ สิ้นช่วง)'}</span><b className="num">{show(c?.ap)}</b>
        {c && b && <small><Delta cur={c.ap} base={b.ap} good="none" /> {vs}</small>}
      </button>
      <button className="kpi" data-tone="bank" onClick={() => onGo('/reports/center?g=5')}>
        <span>เงินสดรับ − จ่าย สุทธิ</span><b className="num">{show(c?.cash_net)}</b>
        {c && <small>รับ {fmt(c.cash_in ?? 0)} · จ่าย {fmt(c.cash_out ?? 0)}</small>}
        {c && (d(c.deposit_ar ?? 0).gt(0) || d(c.deposit_ap ?? 0).gt(0)) && <small>หักมัดจำแล้ว: ขาย {fmt(c.deposit_ar ?? 0)} · ซื้อ {fmt(c.deposit_ap ?? 0)}</small>}
      </button>
      <button className="kpi" data-tone="gl" onClick={() => onGo('/fs/statements?kind=PL')}>
        <span>กำไรสุทธิเบื้องต้น</span><b className="num">{show(c?.profit)}</b>
        {c && <small>อัตรากำไรสุทธิ <b>{c.margin === null ? '—' : `${c.margin}%`}</b> {b && <Delta cur={c.profit} base={b.profit} good="up" />}</small>}
      </button>
    </div>
  );
}

/** กราฟแท่งยอดขาย + เส้นปีที่แล้ว */
function SalesTrend({ data, ys, focus, onPick }: { data: Dash; ys: YearSystem; focus: { from: string; to: string } | null; onPick: (t: Dash['trend'][number]) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const T = data.trend;
  const hasLy = T.some((t) => num(t.sales_ly) !== 0);
  const max = niceMax(Math.max(0, ...T.map((t) => num(t.sales)), ...(hasLy ? T.map((t) => num(t.sales_ly)) : [])));
  const H = 240, L = 64, R = 8, top = 12, bottom = 28;
  const ih = H - top - bottom, slot = (w - L - R) / Math.max(1, T.length), bw = Math.max(2, Math.min(42, slot * 0.62));
  const y = (v: number) => top + ih - (Math.max(0, v) / max) * ih;
  const every = Math.ceil(T.length / Math.max(1, Math.floor((w - L) / 46)));
  const h = hover === null ? null : T[hover];
  if (!T.some((t) => num(t.sales) !== 0) && !hasLy) return <div ref={ref} className="dash-empty">ไม่มียอดขายในช่วงนี้</div>;
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={H} role="img" aria-label="กราฟยอดขายตามช่วงเวลา">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={L} x2={w - R} y1={y(max * f)} y2={y(max * f)} className="grid" /><text x={L - 6} y={y(max * f) + 4} className="ax" textAnchor="end">{compact(max * f)}</text></g>)}
        {T.map((t, i) => {
          const x = L + slot * i + (slot - bw) / 2, v = num(t.sales), sel = !!focus && focus.from === t.from && focus.to === t.to;
          return (
            <g key={t.key} className="hit" onClick={() => onPick(t)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + slot * i} y={top} width={slot} height={ih} fill="transparent" />
              <rect x={x} y={y(v)} width={bw} height={Math.max(0, top + ih - y(v))} rx={3} style={{ fill: C_SALES }} opacity={focus && !sel ? 0.35 : hover === i ? 1 : 0.85} />
              {i % every === 0 && <text x={L + slot * i + slot / 2} y={H - 9} className="ax" textAnchor="middle">{bucketLabel(t.key, data.grain, ys, true)}</text>}
            </g>
          );
        })}
        {hasLy && <polyline fill="none" stroke={C_LY} strokeWidth={2} strokeDasharray="5 4" points={T.map((t, i) => `${L + slot * i + slot / 2},${y(num(t.sales_ly))}`).join(' ')} pointerEvents="none" />}
      </svg>
      <div className="chart-tip">{h ? <>{bucketLabel(h.key, data.grain, ys)}: <b className="num">{fmt(h.sales)}</b> ({h.docs} ใบ){h.sales_ly !== null && hasLy ? <> · ปีที่แล้ว <span className="num">{fmt(h.sales_ly)}</span></> : null}</> : <>รวมทั้งช่วง <b className="num">{fmt(T.reduce((s, t) => s.plus(t.sales), d(0)))}</b></>}</div>
    </div>
  );
}

/** กราฟแท่งแนวนอน (สินค้าขายดี / หมวดสินค้า) */
function HBars({ rows, onPick, pickHint, active }: { rows: Array<{ key: string; label: string; sub: string; amount: string }>; onPick?: (r: { key: string }) => void; pickHint?: string; active?: string }) {
  if (!rows.length) return <div className="dash-empty">ไม่มียอดขายในช่วงนี้</div>;
  const max = Math.max(...rows.map((r) => num(r.amount)), 1);
  return (
    <ol className="hbars">
      {rows.map((r, i) => (
        <li key={r.key || i} className={cx(onPick && 'row-open', active && r.key === active && 'on')} onClick={onPick ? () => onPick(r) : undefined} title={pickHint}>
          <div className="hb-label"><span className="hb-rank">{i + 1}</span><span className="hb-name">{r.label}</span><span className="num">{fmt(r.amount)}</span></div>
          <div className="hb-track"><div className="hb-bar" style={{ width: `${Math.max(1, (num(r.amount) / max) * 100)}%` }} /></div>
          <div className="hb-sub muted">{r.sub}</div>
        </li>
      ))}
    </ol>
  );
}

/** อายุลูกหนี้/เจ้าหนี้: แท่งซ้อนแนวนอน 2 แถว + ตารางยอดแต่ละช่วง */
function Aging({ data, onGo }: { data: Dash; onGo: (p: string) => void }) {
  const A = data.aging;
  const tot = (xs: string[]) => xs.reduce((s, x) => s.plus(x), d(0));
  const max = Math.max(num(tot(A.ar).toFixed(2)), num(tot(A.ap).toFixed(2)), 1);
  const row = (label: string, xs: string[], path: string) => {
    const t = tot(xs);
    return (
      <div className="aging-row">
        <div className="aging-head"><span>{label}</span><b className="num">{fmt(t)}</b></div>
        <div className="aging-bar" style={{ width: `${Math.max(2, (num(t.toFixed(2)) / max) * 100)}%` }}>
          {xs.map((x, i) => num(x) > 0 && <button key={i} className="aging-seg" style={{ flexGrow: num(x), background: AGING_COLORS[i] }} title={`${A.buckets[i]}: ${fmt(x)}`} aria-label={`${label} ${A.buckets[i]} ${fmt(x)}`} onClick={() => onGo(path)} />)}
        </div>
      </div>
    );
  };
  return (
    <div className="aging">
      {row('ลูกหนี้', A.ar, '/reports/center?g=1.C')}
      {row('เจ้าหนี้', A.ap, '/reports/center?g=2.C')}
      <table className="aging-table">
        <thead><tr><th>ช่วงอายุหนี้</th><th className="r">ลูกหนี้</th><th className="r">เจ้าหนี้</th></tr></thead>
        <tbody>{A.buckets.map((b, i) => <tr key={b}><td><i className="dot" style={{ background: AGING_COLORS[i] }} />{b}</td><td className="r num">{fmt(A.ar[i] ?? 0, { blankZero: true }) || '-'}</td><td className="r num">{fmt(A.ap[i] ?? 0, { blankZero: true }) || '-'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** รายได้/ค่าใช้จ่ายรายเดือน (แท่งคู่) + จุดกำไร */
function RevExp({ data, ys, focus, onPick }: { data: Dash; ys: YearSystem; focus: { from: string; to: string } | null; onPick: (month: string, from: string, to: string) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const P = data.pl;
  const months = useMemo(() => P.map((p) => p.month), [P]);
  if (!P.length) return <div ref={ref} className="dash-empty">ยังไม่มีรายการบัญชีในช่วงนี้</div>;
  // แกนเริ่มที่ศูนย์ หรือต่ำกว่าศูนย์เมื่อขาดทุน — ระยะห่างเส้นแกนเป็นตัวเลขกลม
  const rawHi = Math.max(0, ...P.flatMap((p) => [num(p.revenue), num(p.expense), num(p.profit)]));
  const rawLo = Math.min(0, ...P.flatMap((p) => [num(p.revenue), num(p.expense), num(p.profit)]));
  const step = niceMax((rawHi - rawLo) / 4 || 1);
  const hi = Math.ceil(rawHi / step) * step || step, lo2 = Math.floor(rawLo / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo2) / step) + 1 }, (_, i) => lo2 + i * step);
  const H = 240, L = 64, R = 8, top = 12, bottom = 28, ih = H - top - bottom;
  const y = (v: number) => top + ((hi - v) / (hi - lo2)) * ih;
  const slot = (w - L - R) / months.length, bw = Math.max(2, Math.min(22, slot * 0.32));
  const every = Math.ceil(months.length / Math.max(1, Math.floor((w - L) / 40)));
  const range = (m: string) => { const from = `${m}-01`; const to = addDays(addMonths(from, 1), -1); return { from: from < data.range.from ? data.range.from : from, to: to > data.range.to ? data.range.to : to }; };
  const h = hover === null ? null : P[hover];
  return (
    <div ref={ref} className="chart">
      <div className="legend"><span><i style={{ background: C_REV }} />รายได้</span><span><i style={{ background: C_EXP }} />ค่าใช้จ่าย</span><span><i className="ring" style={{ borderColor: C_PROFIT }} />กำไร (ขาดทุน)</span></div>
      <svg width={w} height={H} role="img" aria-label="กราฟรายได้เทียบค่าใช้จ่าย">
        {ticks.map((v) => { return <g key={v}><line x1={L} x2={w - R} y1={y(v)} y2={y(v)} className={cx('grid', Math.abs(v) < 1e-9 && 'zero')} /><text x={L - 6} y={y(v) + 4} className="ax" textAnchor="end">{compact(v)}</text></g>; })}
        {P.map((p, i) => {
          const cx0 = L + slot * i + slot / 2, r = range(p.month), sel = !!focus && focus.from === r.from && focus.to === r.to;
          const bar = (v: number, x: number, fill: string) => <rect x={x} y={Math.min(y(v), y(0))} width={bw} height={Math.abs(y(v) - y(0))} rx={2} fill={fill} opacity={focus && !sel ? 0.35 : 0.9} />;
          return (
            <g key={p.month} className="hit" onClick={() => onPick(p.month, r.from, r.to)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + slot * i} y={top} width={slot} height={ih} fill={hover === i ? 'var(--row-hover)' : 'transparent'} />
              {bar(num(p.revenue), cx0 - bw - 1, C_REV)}
              {bar(num(p.expense), cx0 + 1, C_EXP)}
              <circle cx={cx0} cy={y(num(p.profit))} r={4} fill="var(--surface)" stroke={C_PROFIT} strokeWidth={2} />
              {i % every === 0 && <text x={cx0} y={H - 9} className="ax" textAnchor="middle">{MONTH_TH_SHORT[Number(p.month.slice(5, 7)) - 1]}</text>}
            </g>
          );
        })}
      </svg>
      <div className="chart-tip">{h ? <>{MONTH_TH_SHORT[Number(h.month.slice(5, 7)) - 1]} {yy(h.month, ys)}: รายได้ <b className="num">{fmt(h.revenue)}</b> · ค่าใช้จ่าย <b className="num">{fmt(h.expense)}</b> · กำไร <b className="num">{fmt(h.profit, { paren: true })}</b></> : <>ชี้ที่เดือนเพื่อดูตัวเลข</>}</div>
    </div>
  );
}
