import { useEffect, useMemo, useState } from 'react';
import { PrintPage } from './components/DocPrint';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MENU, flattenMenu, formatDate, type MenuItem } from '@buddy/core';
import { useSession } from './session';
import type { Me } from './api';
import { cx, DateInput, Modal, Toasts, toastError, useHotkeys } from './ui';
import { MenuSearch } from './components/MenuSearch';
import { LoginPage, SetupPage } from './pages/Login';
import { SignupPage } from './pages/Signup';
import { LangSwitch } from './components/LangSwitch';
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
import { MfaRequiredPage } from './pages/settings/TwoFactor';
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
import { PrintFormsPage } from './pages/settings/PrintForms';
import { AssetAccountGroupsPage, AssetFormPage, AssetsPage, DepreciationPage } from './pages/fa/Assets';
import { YearEndPage } from './pages/gl/YearEnd';
import { BackupPage } from './pages/settings/Backup';
import { ApiKeysPage } from './pages/settings/ApiKeys';
import { PdpaPage } from './pages/settings/Pdpa';
import { DevicesPage, SyncPage, SyncBadge } from './pages/settings/Sync';
import { EtaxPage } from './pages/tax/Etax';
import { AiSettingsPage } from './pages/settings/AiSettings';
import { ActivityLogPage } from './pages/settings/ActivityLog';
import { TradeImportPage } from './pages/tools/TradeImport';
import { AuxTools } from './components/AuxTools';
import { DataTablesPage } from './pages/settings/DataTables';
import { TradeFormPage, TradeListPage } from './pages/docs/TradeDocs';
import { SettleFormPage, SettleListPage } from './pages/docs/SettleDocs';
import { CashFormPage, CashListPage } from './pages/docs/CashDocs';
import { BillFormPage, BillListPage } from './pages/docs/BillDocs';
import { PettyFormPage, PettyListPage } from './pages/docs/PettyCash';
import { OpeningFormPage, OpeningListPage } from './pages/docs/OpeningDocs';
import { WhtRegisterPage } from './pages/tax/WhtRegister';
import { VatRegisterPage } from './pages/tax/VatRegister';
import { StockPage } from './pages/inventory/Stock';
import { CountsPage } from './pages/inventory/Counts';
import { StockOpeningFormPage, StockOpeningListPage } from './pages/inventory/StockOpening';
import { SerialsPage } from './pages/inventory/Serials';
import { BankBookPage, BankDocFormPage, BankDocListPage } from './pages/docs/BankDocs';
import { ChequeActionPage, ChequeRegisterPage, ChequeSlipFormPage, ChequeSlipListPage } from './pages/docs/Cheques';
import { BankReconPage } from './pages/docs/BankRecon';
import { ReportCenterPage } from './pages/reports/ReportCenter';
import { DashboardPage } from './pages/reports/Dashboard';
import { DocLocatePage } from './components/DocLink';
import { InventoryAccountPage } from './pages/gl/InventoryAccount';
import { StockDocFormPage, StockDocListPage } from './pages/docs/StockDocs';
import { BANK_KINDS, BILL_KINDS, CASH_KINDS, SETTLE_KINDS, STOCK_KINDS, TRADE_KINDS } from '@buddy/core';

export const TONE: Record<string, string> = { PU: 'purchase', SA: 'sales', FI: 'finance', 'FI.BK': 'bank', TX: 'tax', IC: 'inventory', GL: 'gl', RP: 'reports', SET: 'setup', OT: 'home' };
/** ไอคอนเมนูหลัก (แทนตัวเลขปุ่มลัดเดิม — เห็นได้แม้ย่อแถบเมนู) */
const ICON: Record<string, string> = { PU: '🛒', SA: '🏷️', FI: '💰', 'FI.BK': '🏦', TX: '🧾', IC: '📦', GL: '📒', RP: '📊', SET: '⚙️', OT: '🧰' };
const PHASE_TH: Record<string, string> = { P0: 'ฐานระบบ', P1: 'บัญชีแยกประเภท', P2: 'แฟ้มหลัก', P3: 'ซื้อ ขาย ภาษี', P4: 'ธนาคาร สินค้า', P5: 'รายงาน', P6: 'ผู้ดูแลระบบ', P7: 'ต่อยอด' };

export function App() {
  const { me, loading, needsSetup } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  if (loading) return <div className="boot">กำลังเปิด Buddy Account…</div>;
  if (needsSetup) return <><SetupPage /><Toasts /></>;
  // สมัครใช้งานเอง (ข้อกำหนดเจ้าของ): ลิงก์ /signup เปิดได้โดยไม่ต้องเข้าระบบ
  if (!me) return <>{loc.pathname === '/signup' ? <SignupPage onBack={() => nav('/')} /> : <LoginPage />}<Toasts /></>;
  if (me.user.mfa_setup_required) return <><MfaRequiredPage /><Toasts /></>;
  // หน้าพิมพ์แยก (เปิดจากปุ่ม "เปิดหน้าพิมพ์ในแท็บใหม่"): เอกสารอย่างเดียว ไม่มีเมนู
  const pm = /^\/print\/(doc|journal)\/([0-9a-f-]{36})$/.exec(loc.pathname);
  if (pm) return <><PrintPage kind={pm[1] as 'doc' | 'journal'} id={pm[2]!} slot={Number(new URLSearchParams(loc.search).get('slot')) || 1} /><Toasts /></>;
  return <><Shell /><AuxTools /><Toasts /></>;
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
  // เมนูแบบเลื่อนออก (มือถือ/แท็บเล็ต) วางใต้แถบบนพอดี ไม่ว่าแถบบนจะสูงกี่แถว
  useEffect(() => {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty('--top-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set); ro.observe(bar);
    return () => ro.disconnect();
  }, [me?.company?.id]);
  // ไม่มีปุ่มลัด Alt+ตัวเลขของเมนูหลักแล้ว (เมนูเพิ่มได้ไม่จำกัด) — ใช้ค้นหาเมนู Ctrl+K แทน
  const [search, setSearch] = useState(false);
  useHotkeys({ 'Alt+H': () => nav('/'), 'Ctrl+K': () => setSearch(true) }, []);
  const ys = me?.company?.year_system ?? 'B';
  if (!me?.company) {
    return (
      <div className="page narrow">
        <h1>ยังไม่มีบริษัท</h1>
        <p className="lead">เริ่มจากสร้างบริษัทใหม่ หรือนำข้อมูลจากโปรแกรม Express เข้ามา</p>
        <div className="actions"><button className="primary" onClick={() => nav('/companies/new')}>กำหนดบริษัทใหม่</button>
          {me?.user.is_platform && <button onClick={() => nav('/admin/tenants')}>ลูกค้าผู้ใช้บริการ / รับลูกค้าที่ย้ายมา</button>}
          <button onClick={() => logout()}>ออกจากระบบ</button></div>
        <Routes><Route path="/companies/new" element={<NewCompanyPage />} />{me?.user.is_platform && <Route path="/admin/tenants" element={<TenantsPage />} />}<Route path="*" element={null} /></Routes>
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
          <SyncBadge />
          <button className="period" onClick={() => setWorkDateOpen(true)} title="เปลี่ยนวันทำการ">วันทำการ {formatDate(me.work_date ?? new Date().toISOString().slice(0, 10), ys)}</button>
          <button className="user link" title={`${me.user.username} — รหัสผ่านและยืนยันตัวตนสองขั้น`} onClick={() => nav('/account/password')}>{me.user.display_name}</button>
          <LangSwitch />
          <button onClick={() => logout()} title="ออกจากระบบ">ออก</button>
        </div>
      </header>
      <nav className="sidebar" aria-label="เมนูหลัก">
        <button className="mini-btn" onClick={() => setMini((x) => !x)} title={mini ? 'ขยายเมนู' : 'ย่อเมนู'}>{mini ? '»' : '«'}</button>
        <button className="menu-search-btn" onClick={() => setSearch(true)} title="ค้นหาเมนู (Ctrl+K)"><span className="hot">🔍</span><span className="lbl">ค้นหาเมนู</span><kbd className="lbl">Ctrl+K</kbd></button>
        <NavLink to="/" end className={({ isActive }) => cx('menu-home', isActive && 'on')} data-tone="home" title="หน้าแรก (Alt+H)"><span className="hot">🏠</span><span className="lbl">หน้าแรก</span></NavLink>
        {MENU.filter((g) => canSee(g, me.perms)).map((g) => (
          <div key={g.code} id={`menu-${g.code}`} className={cx('menu', open === g.code && 'open')} data-tone={TONE[g.code]}>
            <button className="menu-head" onClick={() => { setOpen(open === g.code ? null : g.code); setMini(false); }} aria-expanded={open === g.code} title={g.label}>
              <span className="hot">{ICON[g.code] ?? '•'}</span><span className="lbl">{g.label}</span>
            </button>
            {open === g.code && !mini && <div className="sub">{g.children!.filter((it) => canSee(it, me.perms)).map((it) => <MenuEntry key={it.code} it={it} perms={me.perms} />)}</div>}
          </div>
        ))}
      </nav>
      {search && <MenuSearch perms={me.perms} onClose={() => setSearch(false)} />}
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
          <Route path="/ic/stock" element={<StockPage />} />
          <Route path="/ic/counts" element={<CountsPage />} />
          <Route path="/ic/opening" element={<StockOpeningListPage />} />
          <Route path="/ic/opening/:id" element={<StockOpeningFormPage />} />
          <Route path="/ic/serials" element={<SerialsPage />} />
          {BANK_KINDS.flatMap((k) => [<Route key={k.cls} path={k.route} element={<BankDocListPage key={k.cls} cls={k.cls} />} />, <Route key={k.cls + '-f'} path={`${k.route}/:id`} element={<BankDocFormPage key={k.cls + '-f'} cls={k.cls} />} />])}
          <Route path="/fi/bank/book" element={<BankBookPage />} />
          <Route path="/fi/bank/reconcile" element={<BankReconPage />} />
          <Route path="/gl/inventory" element={<InventoryAccountPage />} />
          <Route path="/fi/cheques/received" element={<ChequeRegisterPage key="R" direction="R" />} />
          <Route path="/fi/cheques/paid" element={<ChequeRegisterPage key="P" direction="P" />} />
          <Route path="/fi/cheques/deposit" element={<ChequeActionPage key="dep" mode="deposit" />} />
          <Route path="/fi/cheques/pass" element={<ChequeActionPage key="pass" mode="pass" />} />
          <Route path="/fi/cheques/pass-paid" element={<ChequeActionPage key="passp" mode="pass-paid" />} />
          <Route path="/fi/cheques/slips" element={<ChequeSlipListPage />} />
          <Route path="/fi/cheques/slips/:id" element={<ChequeSlipFormPage />} />
          {STOCK_KINDS.flatMap((k) => [<Route key={k.cls} path={k.route} element={<StockDocListPage key={k.cls} cls={k.cls} />} />, <Route key={k.cls + '-f'} path={`${k.route}/:id`} element={<StockDocFormPage key={k.cls + '-f'} cls={k.cls} />} />])}
          <Route path="/tax/vat/P" element={<VatRegisterPage key="P" kind="P" />} />
          <Route path="/tax/vat/S" element={<VatRegisterPage key="S" kind="S" />} />
          <Route path="/tax/etax" element={<EtaxPage />} />
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
          <Route path="/settings/print-forms" element={<PrintFormsPage />} />
          <Route path="/settings/asset-account-groups" element={<AssetAccountGroupsPage />} />
          <Route path="/fa/assets" element={<AssetsPage />} />
          <Route path="/fa/assets/:id" element={<AssetFormPage />} />
          <Route path="/fa/depreciation" element={<DepreciationPage />} />
          <Route path="/gl/year-end" element={<YearEndPage />} />
          <Route path="/tools/backup" element={<BackupPage />} />
          <Route path="/settings/api-keys" element={<ApiKeysPage />} />
          <Route path="/settings/pdpa" element={<PdpaPage />} />
          <Route path="/settings/devices" element={<DevicesPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/settings/ai" element={<AiSettingsPage />} />
          <Route path="/tools/activity-log" element={<ActivityLogPage />} />
          <Route path="/tools/trade-import" element={<TradeImportPage />} />
          <Route path="/settings/gl-link" element={<GlLinkPage />} />
          <Route path="/settings/data-tables" element={<DataTablesPage />} />
          {TRADE_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<TradeListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<TradeFormPage key={k.path} path={k.path} />} />])}
          {SETTLE_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<SettleListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<SettleFormPage key={k.path} path={k.path} />} />])}
          {CASH_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<CashListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<CashFormPage key={k.path} path={k.path} />} />])}
          {BILL_KINDS.map((k) => [<Route key={k.path} path={k.route} element={<BillListPage key={k.path} path={k.path} />} />, <Route key={k.path + '-f'} path={`${k.route}/:id`} element={<BillFormPage key={k.path} path={k.path} />} />])}
          <Route path="/fi/ar/opening" element={<OpeningListPage key="ar" kind="ar" />} />
          <Route path="/fi/ar/opening/:id" element={<OpeningFormPage key="ar-f" kind="ar" />} />
          <Route path="/fi/ap/opening" element={<OpeningListPage key="ap" kind="ap" />} />
          <Route path="/fi/ap/opening/:id" element={<OpeningFormPage key="ap-f" kind="ap" />} />
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
          <Route path="/reports/center" element={<ReportCenterPage />} />
          <Route path="/reports/dashboard" element={<DashboardPage />} />
          <Route path="/doc/:id" element={<DocLocatePage />} />
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
