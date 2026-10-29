import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MENU, flattenMenu, formatDate, type MenuItem } from '@buddy/core';
import { useSession } from './session';
import type { Me } from './api';
import { cx, DateInput, Modal, Toasts, toastError, useHotkeys } from './ui';
import { LoginPage, SetupPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { AccountsPage } from './pages/gl/Accounts';
import { JournalsPage } from './pages/gl/Journals';
import { JournalFormPage } from './pages/gl/JournalForm';
import { BooksPage } from './pages/gl/Books';
import { TemplatesPage } from './pages/gl/Templates';
import { PermissionsPage } from './pages/settings/Permissions';
import { DefaultsPage } from './pages/settings/Defaults';
import { PriorYearPage } from './pages/gl/PriorYear';
import { BudgetPage } from './pages/gl/Budget';
import { AccountDetailPage } from './pages/reports/AccountDetail';
import { OpeningPage } from './pages/gl/Opening';
import { CompanyPage } from './pages/settings/Company';
import { PeriodsPage } from './pages/settings/Periods';
import { DepartmentsPage } from './pages/settings/Departments';
import { BranchesPage } from './pages/settings/Branches';
import { UsersPage } from './pages/settings/Users';
import { NewCompanyPage } from './pages/settings/NewCompany';
import { PasswordPage } from './pages/settings/Password';
import { ImportPage } from './pages/settings/Import';
import { TenantsPage } from './pages/settings/Tenants';
import { TrialBalancePage } from './pages/reports/TrialBalance';
import { LedgerPage } from './pages/reports/Ledger';
import { JournalBookPage } from './pages/reports/JournalBook';
import { StatementsPage } from './pages/reports/Statements';
import { FsLayoutsPage } from './pages/reports/FsLayouts';
import { CustomersPage, SalespersonsPage, SuppliersPage } from './pages/parties/Parties';
import { Wht50Page } from './pages/tax/Wht50';
import { KitsPage, OtherExpensesPage, OtherIncomesPage, ServicesPage, StockItemsPage } from './pages/items/Items';
import { ItemAccountGroupsPage, PricesPage, ReorderPage } from './pages/items/ItemTables';
import { BankAccountsPage, PaymentMethodsPage } from './pages/finance/Banking';
import { DocTypesPage, GlLinkPage } from './pages/settings/DocTypes';
import { DataTablesPage } from './pages/settings/DataTables';
import { TradeFormPage, TradeListPage } from './pages/docs/TradeDocs';
import { SettleFormPage, SettleListPage } from './pages/docs/SettleDocs';
import { CashFormPage, CashListPage } from './pages/docs/CashDocs';
import { BillFormPage, BillListPage } from './pages/docs/BillDocs';
import { PettyFormPage, PettyListPage } from './pages/docs/PettyCash';
import { WhtRegisterPage } from './pages/tax/WhtRegister';
import { BILL_KINDS, CASH_KINDS, SETTLE_KINDS, TRADE_KINDS } from '@buddy/core';

export const TONE: Record<string, string> = { PU: 'purchase', SA: 'sales', FI: 'finance', IC: 'inventory', GL: 'gl', RP: 'reports', SET: 'setup', OT: 'home' };
const PHASE_TH: Record<string, string> = { P0: 'ฐานระบบ', P1: 'บัญชีแยกประเภท', P2: 'แฟ้มหลัก', P3: 'ซื้อ ขาย ภาษี', P4: 'ธนาคาร สินค้า', P5: 'รายงาน', P6: 'ผู้ดูแลระบบ', P7: 'ต่อยอด' };

export function App() {
  const { me, loading, needsSetup } = useSession();
  if (loading) return <div className="boot">กำลังเปิด Buddy Account…</div>;
  if (needsSetup) return <><SetupPage /><Toasts /></>;
  if (!me) return <><LoginPage /><Toasts /></>;
  return <><Shell /><Toasts /></>;
}

function Shell() {
  const { me, select, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState<string | null>(() => MENU.find((g) => flattenMenu(g.children).some((i) => i.route && loc.pathname.startsWith(i.route)))?.code ?? 'GL');
  const [mini, setMini] = useState(false);
  const [workDateOpen, setWorkDateOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => setMobileMenu(false), [loc.pathname]);
  const hot = useMemo(() => Object.fromEntries(MENU.map((g) => [`Alt+${g.hotkey}`, () => { setOpen(g.code); setMini(false); setTimeout(() => document.querySelector<HTMLElement>(`#menu-${g.code} .sub a, #menu-${g.code} .sub button`)?.focus(), 0); }])), []);
  useHotkeys({ ...hot, 'Alt+H': () => nav('/') }, []);
  const ys = me?.company?.year_system ?? 'B';
  if (!me?.company) {
    return (
      <div className="page narrow">
        <h1>ยังไม่มีบริษัท</h1>
        <p className="lead">เริ่มจากสร้างบริษัทใหม่ หรือนำข้อมูลจากโปรแกรม Express เข้ามา</p>
        <div className="actions"><button className="primary" onClick={() => nav('/companies/new')}>กำหนดบริษัทใหม่</button><button onClick={() => logout()}>ออกจากระบบ</button></div>
        <Routes><Route path="/companies/new" element={<NewCompanyPage />} /><Route path="*" element={null} /></Routes>
      </div>
    );
  }
  return (
    <div className={cx('shell', mini && 'mini', mobileMenu && 'menu-open')}>
      <header className="topbar">
        <button className="burger" onClick={() => setMobileMenu((x) => !x)} aria-label="เมนู">☰</button>
        <button className="brand" onClick={() => nav('/')} title="หน้าแรก (Alt+H)"><b>Buddy Account</b><span>โปรแกรมบัญชี</span></button>
        <select className="company-sel" value={me.company.id} aria-label="บริษัท" onChange={(e) => select({ company_id: e.target.value }).then(() => nav('/')).catch(toastError)}>
          {me.companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name_th}</option>)}
        </select>
        <div className="scope">
          {me.branches.length > 1 && (
            <select value={me.branch?.id ?? ''} aria-label="สาขา" onChange={(e) => select({ branch_id: e.target.value || null }).catch(toastError)}>
              <option value="">ทุกสาขา</option>
              {me.branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}
            </select>
          )}
          <button className="period" onClick={() => setWorkDateOpen(true)} title="เปลี่ยนวันทำการ">วันทำการ {formatDate(me.work_date ?? new Date().toISOString().slice(0, 10), ys)}</button>
          <span className="user" title={me.user.username}>{me.user.display_name}</span>
          <button onClick={() => logout()} title="ออกจากระบบ">ออก</button>
        </div>
      </header>
      <nav className="sidebar" aria-label="เมนูหลัก">
        <button className="mini-btn" onClick={() => setMini((x) => !x)} title={mini ? 'ขยายเมนู' : 'ย่อเมนู'}>{mini ? '»' : '«'}</button>
        <NavLink to="/" end className={({ isActive }) => cx('menu-home', isActive && 'on')} data-tone="home"><span className="hot">H</span><span className="lbl">หน้าแรก</span></NavLink>
        {MENU.filter((g) => canSee(g, me.perms)).map((g) => (
          <div key={g.code} id={`menu-${g.code}`} className={cx('menu', open === g.code && 'open')} data-tone={TONE[g.code]}>
            <button className="menu-head" onClick={() => { setOpen(open === g.code ? null : g.code); setMini(false); }} aria-expanded={open === g.code} title={`${g.label} (Alt+${g.hotkey})`}>
              <span className="hot">{g.hotkey}</span><span className="lbl">{g.label}</span>
            </button>
            {open === g.code && !mini && <div className="sub">{g.children!.filter((it) => canSee(it, me.perms)).map((it) => <MenuEntry key={it.code} it={it} perms={me.perms} />)}</div>}
          </div>
        ))}
      </nav>
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/gl/accounts" element={<AccountsPage />} />
          <Route path="/gl/journals" element={<JournalsPage />} />
          <Route path="/gl/journals/new" element={<JournalFormPage />} />
          <Route path="/gl/journals/:id" element={<JournalFormPage />} />
          <Route path="/gl/books" element={<BooksPage />} />
          <Route path="/gl/templates" element={<TemplatesPage />} />
          <Route path="/gl/prior-year" element={<PriorYearPage />} />
          <Route path="/gl/budget" element={<BudgetPage />} />
          <Route path="/gl/opening" element={<OpeningPage />} />
          <Route path="/settings/company" element={<CompanyPage />} />
          <Route path="/settings/periods" element={<PeriodsPage />} />
          <Route path="/settings/departments" element={<DepartmentsPage />} />
          <Route path="/settings/branches" element={<BranchesPage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/permissions" element={<PermissionsPage />} />
          <Route path="/settings/defaults" element={<DefaultsPage />} />
          <Route path="/ar/customers" element={<CustomersPage />} />
          <Route path="/ap/suppliers" element={<SuppliersPage />} />
          <Route path="/ar/salespersons" element={<SalespersonsPage />} />
          <Route path="/tax/wht50" element={<Wht50Page />} />
          <Route path="/tax/wht" element={<WhtRegisterPage />} />
          <Route path="/ic/items" element={<StockItemsPage />} />
          <Route path="/ic/kits" element={<KitsPage />} />
          <Route path="/ic/services" element={<ServicesPage />} />
          <Route path="/ar/other-incomes" element={<OtherIncomesPage />} />
          <Route path="/ap/other-expenses" element={<OtherExpensesPage />} />
          <Route path="/ic/prices" element={<PricesPage />} />
          <Route path="/ic/reorder" element={<ReorderPage />} />
          <Route path="/settings/item-account-groups" element={<ItemAccountGroupsPage />} />
          <Route path="/fi/bank-accounts" element={<BankAccountsPage />} />
          <Route path="/settings/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/settings/doc-types" element={<DocTypesPage />} />
          <Route path="/settings/gl-link" element={<GlLinkPage />} />
          <Route path="/settings/data-tables" element={<DataTablesPage />} />
          {TRADE_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<TradeListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<TradeFormPage key={k.path} path={k.path} />} />])}
          {SETTLE_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<SettleListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<SettleFormPage key={k.path} path={k.path} />} />])}
          {CASH_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<CashListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<CashFormPage key={k.path} path={k.path} />} />])}
          {BILL_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<BillListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<BillFormPage key={k.path} path={k.path} />} />])}
          <Route path="/gl/petty-cash" element={<PettyListPage key="dp" kind="dp" />} />
          <Route path="/gl/petty-cash/vr" element={<PettyListPage key="vr" kind="vr" />} />
          <Route path="/gl/petty-cash/dp/:id" element={<PettyFormPage key="dp-f" kind="dp" />} />
          <Route path="/gl/petty-cash/vr/:id" element={<PettyFormPage key="vr-f" kind="vr" />} />
          <Route path="/fi/ar/bill-appointments" element={<BillListPage key="appoint" path="ar-bills" appointments />} />
          <Route path="/companies/new" element={<NewCompanyPage />} />
          <Route path="/account/password" element={<PasswordPage />} />
          <Route path="/admin/import" element={<ImportPage />} />
          <Route path="/admin/tenants" element={<TenantsPage />} />
          <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
          <Route path="/reports/ledger" element={<LedgerPage />} />
          <Route path="/reports/account-detail" element={<AccountDetailPage />} />
          <Route path="/reports/journal-book" element={<JournalBookPage />} />
          <Route path="/fs/statements" element={<StatementsPage />} />
          <Route path="/fs/layouts" element={<FsLayoutsPage />} />
          <Route path="/planned/:code" element={<PlannedPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {workDateOpen && <WorkDateDialog onClose={() => setWorkDateOpen(false)} />}
    </div>
  );
}

/** เมนูที่เปิดใช้แล้วแสดงเฉพาะที่มีสิทธิ์อ่าน (คู่มือบทที่ 23) · เมนูที่อยู่ในแผนแสดงเสมอ */
function canSee(it: MenuItem, perms: Me['perms'] | undefined): boolean {
  if (it.children) return it.children.some((c) => canSee(c, perms));
  return !it.route || perms?.[it.code]?.read !== false;
}

function MenuEntry({ it, perms }: { it: MenuItem; perms: Me['perms'] | undefined }) {
  if (it.children) return <div className="sub-group"><div className="sub-title">{it.label}</div>{it.children.filter((c) => canSee(c, perms)).map((c) => <MenuEntry key={c.code} it={c} perms={perms} />)}</div>;
  if (it.route) return <NavLink to={it.route} className={({ isActive }) => cx('sub-item', isActive && 'on')}>{it.label}</NavLink>;
  return <NavLink to={`/planned/${it.code}`} className={({ isActive }) => cx('sub-item', 'planned', isActive && 'on')} title={`อยู่ในแผน เฟส ${it.phase}`}>{it.label}<span className="phase">{it.phase}</span></NavLink>;
}

function PlannedPage() {
  const { code } = useParams();
  const it = flattenMenu().find((x) => x.code === code);
  if (!it) return <Navigate to="/" />;
  const group = MENU.find((g) => flattenMenu(g.children).some((x) => x.code === code));
  return (
    <div className="page" data-tone={TONE[group?.code ?? 'OT']}>
      <p className="eyebrow">{group?.label}</p>
      <h1>{it.label}</h1>
      <div className="notebox">เมนูนี้อยู่ในแผนพัฒนา <b>เฟส {it.phase} — {PHASE_TH[it.phase]}</b> ยังไม่เปิดใช้งานในรุ่นนี้</div>
      {it.screens?.length ? <p className="muted">หน้าจอในคู่มือ Express ที่เมนูนี้ต้องทำให้ครบ: {it.screens.join(', ')} (ดูรายละเอียดใน docs/04_ความครอบคลุมหน้าจอ.md)</p> : null}
    </div>
  );
}

function WorkDateDialog({ onClose }: { onClose: () => void }) {
  const { me, select } = useSession();
  const [v, setV] = useState(me?.work_date ?? new Date().toISOString().slice(0, 10));
  return (
    <Modal title="เปลี่ยนวันทำการ" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={() => select({ work_date: v }).then(onClose).catch(toastError)}>ตกลง</button></>}>
      <p className="muted">วันทำการใช้เป็นวันที่เริ่มต้นของเอกสารใหม่ (เหมือน Express ป้อนตอนเข้าโปรแกรม)</p>
      <DateInput value={v} onChange={setV} autoFocus />
    </Modal>
  );
}
