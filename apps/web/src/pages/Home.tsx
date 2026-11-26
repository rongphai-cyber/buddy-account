import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MENU, flattenMenu, fmt, formatDate } from '@buddy/core';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { PageHead } from '../ui';
import { DashboardPage } from './reports/Dashboard';

interface TB { totals: { closing_debit: string; closing_credit: string }; balanced: boolean; rows: Array<{ account_no: string; account_group: string; closing: string; is_control: boolean }>; fiscal_year: { code: string; start_date: string; end_date: string } | null }

type Act = 'read' | 'add';
/**
 * ปุ่มเริ่มงานที่ใช้บ่อย (HANDOFF 198 ข้อ 4 · ตรวจทาน 197): ทุกปุ่มผูกกับเมนูและการทำงาน — แสดงเฉพาะที่ผู้ใช้ทำได้
 * เรียงตามงานแต่ละฝ่าย: ขาย · ซื้อ · การเงิน · บัญชี · สินค้า/ธุรการ · บุคคล · รายงาน — แต่ละกลุ่มจึงเห็นปุ่มของงานตัวเอง (สูงสุด 10 ปุ่ม)
 */
const QUICK: Array<{ menu: string; act: Act; to: string; label: string }> = [
  { menu: 'SA.IV', act: 'add', to: '/sa/invoices/new', label: '+ ขายเงินเชื่อ' },
  { menu: 'SA.QT', act: 'add', to: '/sa/quotations/new', label: '+ ใบเสนอราคา' },
  { menu: 'SA.SO', act: 'add', to: '/sa/orders/new', label: '+ ใบสั่งขาย' },
  { menu: 'PU.RR', act: 'add', to: '/pu/invoices/new', label: '+ ซื้อเงินเชื่อ' },
  { menu: 'PU.PO', act: 'add', to: '/pu/orders/new', label: '+ ใบสั่งซื้อ' },
  { menu: 'FI.AR.RE', act: 'add', to: '/fi/ar/receipts/new', label: '+ รับชำระหนี้' },
  { menu: 'FI.AP.PS', act: 'add', to: '/fi/ap/payments/new', label: '+ จ่ายชำระหนี้' },
  { menu: 'GL.JNL', act: 'add', to: '/gl/journals/new', label: '+ บันทึกใบสำคัญ' },
  { menu: 'IC.ITEM', act: 'read', to: '/ic/items', label: 'รายละเอียดสินค้า' },
  { menu: 'IC.STOCK', act: 'read', to: '/ic/stock', label: 'ยอดคงเหลือสินค้า' },
  { menu: 'PAY.RUN', act: 'read', to: '/pay/runs', label: 'บันทึกเงินเดือน' },
  { menu: 'PAY.EMP', act: 'read', to: '/pay/employees', label: 'ทะเบียนพนักงาน' },
  { menu: 'RP.TB', act: 'read', to: '/reports/trial-balance', label: 'งบทดลอง' },
  { menu: 'RP.FS', act: 'read', to: '/fs/statements', label: 'งบการเงิน' },
  { menu: 'RP.CENTER', act: 'read', to: '/reports/center', label: 'ศูนย์รายงาน' },
];
function QuickButtons() {
  const { me } = useSession();
  const nav = useNavigate();
  const can = (q: (typeof QUICK)[number]) => !!me?.perms?.[q.menu]?.[q.act];
  const list = QUICK.filter(can).slice(0, 10);
  return (
    <section className="card">
      <h2>เริ่มงานที่ใช้บ่อย</h2>
      {list.length ? <div className="quick">{list.map((q) => <button key={q.to} onClick={() => nav(q.to)}>{q.label}</button>)}</div>
        : <p className="muted">ยังไม่มีเมนูที่คุณใช้ได้ในบริษัทนี้ — ติดต่อผู้ดูแลระบบของกิจการให้กำหนดกลุ่มผู้ใช้</p>}
      <p className="hint">ค้นหาเมนู: Ctrl+K แล้วพิมพ์ชื่อหน้า · Alt+H กลับหน้าแรก</p>
    </section>
  );
}

export function HomePage() {
  const { me } = useSession();
  const nav = useNavigate();
  const canDash = useCan('RP.DASH')('read');
  // ภาพรวมการเงินอ่านจากงบทดลอง — เฉพาะผู้มีสิทธิ์อ่านงบทดลอง (ไม่งั้น 403 แล้วค้าง "…")
  const canTb = useCan('RP.TB')('read');
  const ys = me?.company?.year_system ?? 'B';
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api.get<Array<{ code: string; start_date: string; end_date: string; journal_count: number }>>('/api/v1/gl/periods') });
  // ปีบัญชีล่าสุดที่มีรายการ
  const year = periods.data?.filter((y) => y.journal_count > 0).at(-1) ?? periods.data?.at(-1);
  const tb = useQuery({ enabled: !!year && canTb, queryKey: ['home-tb', year?.start_date], queryFn: () => api.get<TB>('/api/v1/reports/trial-balance', { from: year!.start_date, to: year!.end_date, level: 1 }) });
  const sumGroup = (g: string) => (tb.data?.rows ?? []).filter((r) => r.account_group === g).reduce((s, r) => s + Number(r.closing), 0);
  const assets = sumGroup('1'), liab = -sumGroup('2'), equity = -sumGroup('3'), rev = -sumGroup('4'), exp = sumGroup('5');
  const show = (v: number) => (tb.data ? fmt(v) : '…');
  const all = flattenMenu().filter((x) => !x.children);
  const ready = all.filter((x) => x.route).length;
  // หน้าแรก = แดชบอร์ดของบริษัทที่เลือกอยู่ (ผู้มีสิทธิ์ RP.DASH) — ข้อมูลเฉพาะบริษัทนั้น เปลี่ยนบริษัทที่แถบด้านบน
  if (canDash) return (
    <DashboardPage home>
      <QuickButtons />
    </DashboardPage>
  );
  return (
    <div className="page home" data-tone="home">
      <PageHead eyebrow={me?.company?.code} title={me?.company?.name_th ?? ''} lead={year ? `ปีบัญชี ${year.code} (${formatDate(year.start_date, ys)} – ${formatDate(year.end_date, ys)})` : 'ยังไม่ได้กำหนดรอบบัญชี'} />
      {canTb ? <div className="kpis">
        <button className="kpi" data-tone="gl" onClick={() => nav('/fs/statements?kind=BS')}><span>สินทรัพย์รวม</span><b className="num">{show(assets)}</b></button>
        <button className="kpi" data-tone="purchase" onClick={() => nav('/fs/statements?kind=BS')}><span>หนี้สินรวม</span><b className="num">{show(liab)}</b></button>
        <button className="kpi" data-tone="sales" onClick={() => nav('/fs/statements?kind=PL')}><span>รายได้</span><b className="num">{show(rev)}</b></button>
        <button className="kpi" data-tone="reports" onClick={() => nav('/fs/statements?kind=PL')}><span>กำไร (ขาดทุน)</span><b className="num">{show(rev - exp)}</b></button>
        <button className="kpi" data-tone="finance" onClick={() => nav('/reports/trial-balance')}><span>งบทดลอง</span><b>{tb.data ? (tb.data.balanced ? 'ดุล ✓' : 'ไม่ดุล ✕') : '…'}</b></button>
      </div> : <p className="notebox small">ภาพรวมการเงิน (สินทรัพย์ รายได้ กำไร) แสดงเฉพาะผู้มีสิทธิ์อ่านงบทดลอง — เลือกงานของคุณจากปุ่มด้านล่างหรือเมนูด้านซ้าย</p>}
      <div className="home-grid">
        <QuickButtons />
        <section className="card">
          <h2>ความพร้อมของโปรแกรม</h2>
          <p>เปิดใช้แล้ว <b>{ready}</b> จาก <b>{all.length}</b> เมนู — เมนูที่ยังไม่เปิดจะแสดงป้ายเฟสพัฒนา</p>
          <ul className="phase-list">
            {MENU.map((g) => { const items = flattenMenu(g.children).filter((x) => !x.children); const done = items.filter((x) => x.route).length; return <li key={g.code}><span>{g.label}</span><span className="muted">{done}/{items.length}</span></li>; })}
          </ul>
        </section>
      </div>
    </div>
  );
}
