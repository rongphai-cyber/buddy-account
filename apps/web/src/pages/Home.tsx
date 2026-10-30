import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MENU, flattenMenu, fmt, formatDate } from '@buddy/core';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { PageHead } from '../ui';

interface TB { totals: { closing_debit: string; closing_credit: string }; balanced: boolean; rows: Array<{ account_no: string; account_group: string; closing: string; is_control: boolean }>; fiscal_year: { code: string; start_date: string; end_date: string } | null }

export function HomePage() {
  const { me } = useSession();
  const nav = useNavigate();
  const canDash = useCan('RP.DASH')('read');
  const ys = me?.company?.year_system ?? 'B';
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api.get<Array<{ code: string; start_date: string; end_date: string; journal_count: number }>>('/api/v1/gl/periods') });
  // ปีบัญชีล่าสุดที่มีรายการ
  const year = periods.data?.filter((y) => y.journal_count > 0).at(-1) ?? periods.data?.at(-1);
  const tb = useQuery({ enabled: !!year, queryKey: ['home-tb', year?.start_date], queryFn: () => api.get<TB>('/api/v1/reports/trial-balance', { from: year!.start_date, to: year!.end_date, level: 1 }) });
  const sumGroup = (g: string) => (tb.data?.rows ?? []).filter((r) => r.account_group === g).reduce((s, r) => s + Number(r.closing), 0);
  const assets = sumGroup('1'), liab = -sumGroup('2'), equity = -sumGroup('3'), rev = -sumGroup('4'), exp = sumGroup('5');
  const show = (v: number) => (tb.data ? fmt(v) : '…');
  const all = flattenMenu().filter((x) => !x.children);
  const ready = all.filter((x) => x.route).length;
  return (
    <div className="page home" data-tone="home">
      <PageHead eyebrow={me?.company?.code} title={me?.company?.name_th ?? ''} lead={year ? `ปีบัญชี ${year.code} (${formatDate(year.start_date, ys)} – ${formatDate(year.end_date, ys)})` : 'ยังไม่ได้กำหนดรอบบัญชี'} />
      <div className="kpis">
        <button className="kpi" data-tone="gl" onClick={() => nav('/fs/statements?kind=BS')}><span>สินทรัพย์รวม</span><b className="num">{show(assets)}</b></button>
        <button className="kpi" data-tone="purchase" onClick={() => nav('/fs/statements?kind=BS')}><span>หนี้สินรวม</span><b className="num">{show(liab)}</b></button>
        <button className="kpi" data-tone="sales" onClick={() => nav('/fs/statements?kind=PL')}><span>รายได้</span><b className="num">{show(rev)}</b></button>
        <button className="kpi" data-tone="reports" onClick={() => nav('/fs/statements?kind=PL')}><span>กำไร (ขาดทุน)</span><b className="num">{show(rev - exp)}</b></button>
        <button className="kpi" data-tone="finance" onClick={() => nav('/reports/trial-balance')}><span>งบทดลอง</span><b>{tb.data ? (tb.data.balanced ? 'ดุล ✓' : 'ไม่ดุล ✕') : '…'}</b></button>
      </div>
      <div className="home-grid">
        <section className="card">
          <h2>เริ่มงานที่ใช้บ่อย</h2>
          <div className="quick">
            {canDash && <button className="primary" onClick={() => nav('/reports/dashboard')}>📊 แดชบอร์ดผู้บริหาร</button>}
            <button onClick={() => nav('/gl/journals/new')}>+ บันทึกใบสำคัญ</button>
            <button onClick={() => nav('/gl/journals')}>สมุดรายวัน</button>
            <button onClick={() => nav('/reports/trial-balance')}>งบทดลอง</button>
            <button onClick={() => nav('/fs/statements')}>งบการเงิน</button>
            <button onClick={() => nav('/gl/accounts')}>ผังบัญชี</button>
            <button onClick={() => nav('/settings/periods')}>ปิดงวด</button>
          </div>
          <p className="hint">ค้นหาเมนู: Ctrl+K แล้วพิมพ์ชื่อหน้า · Alt+H กลับหน้าแรก</p>
        </section>
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
