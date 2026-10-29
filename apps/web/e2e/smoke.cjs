// ทดสอบหน้าจอหลักแบบ end-to-end ด้วย Playwright
// ใช้: BASE=http://localhost:4100 USER=admin PASS=... OUT=/tmp/shots node apps/web/e2e/smoke.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:4100';
const OUT = process.env.OUT || '/tmp/buddy-shots';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts.googleapis|ERR_|401|400/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.log('✗', name, e.message.split('\n')[0]); errors.push(name + ': ' + e.message.split('\n')[0]); await shot('fail-' + name.replace(/\W+/g, '_')); } };

  await step('login', async () => {
    await page.goto(BASE + '/');
    await page.fill('input[autocomplete=username]', process.env.USER_NAME || 'admin');
    await page.fill('input[type=password]', process.env.PASS || 'buddy1234');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.kpis', { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.kpi b')?.textContent?.includes('…'), null, { timeout: 15000 });
    await shot('01-home');
  });
  await step('accounts', async () => {
    await page.goto(BASE + '/gl/accounts');
    await page.waitForSelector('table.grid tbody tr.row-open', { timeout: 15000 });
    const n = await page.locator('table.grid tbody tr.row-open').count();
    if (n < 200) throw new Error('accounts rows ' + n);
    await shot('02-accounts');
    await page.locator('table.grid tbody tr.row-open').nth(3).click();
    await page.waitForSelector('.modal');
    await shot('03-account-form');
    await page.keyboard.press('Escape');
  });
  await step('sample chart of accounts (ไทย–อังกฤษ, view only)', async () => {
    await page.goto(BASE + '/gl/accounts');
    await page.getByRole('button', { name: 'ผังบัญชีตัวอย่าง' }).click();
    await page.waitForSelector('.modal table.grid tbody tr', { timeout: 15000 });
    await shot('02b-chart-template');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  });
  await step('journals list', async () => {
    await page.goto(BASE + '/gl/journals?from=2026-09-01&to=2026-09-30');
    await page.waitForSelector('table.grid tbody tr.row-open', { timeout: 15000 });
    await shot('04-journals');
    await page.locator('table.grid tbody tr.row-open').first().click();
    await page.waitForSelector('.doc-title h1');
    await page.waitForSelector('.lines tbody tr');
    await shot('05-journal-view');
  });
  let newNo = '';
  await step('new journal (keyboard)', async () => {
    await page.goto(BASE + '/gl/journals/new');
    await page.waitForSelector('.lines tbody tr');
    const date = page.locator('.head-grid .date-in input');
    await date.fill('15/10/2569'); await date.press('Enter');
    await page.locator('.head-grid input').nth(2).fill('ทดสอบ');
    await page.locator('.head-grid input').nth(3).fill('ปรับปรุงค่าใช้จ่ายค้างจ่าย (ทดสอบ)');
    const acc = page.locator('.lines tbody tr').nth(0).locator('.lk-in input');
    await acc.fill('5390-01'); await acc.press('Enter');
    const row0 = page.locator('.lines tbody tr').nth(0);
    await row0.locator('select').selectOption({ index: 1 });
    await row0.locator('input.num').nth(0).fill('1,250.50');
    const acc2 = page.locator('.lines tbody tr').nth(1).locator('.lk-in input');
    await acc2.click(); await acc2.fill('2130'); await acc2.press('F4');
    await page.waitForSelector('.modal .lk-table tr.row-open');
    await shot('06-lookup');
    await page.locator('.modal .lk-table tr.row-open').first().click();
    const row1 = page.locator('.lines tbody tr').nth(1);
    await row1.locator('input.num').nth(1).fill('1250.50');
    await row1.locator('input.num').nth(1).press('Tab');
    await page.waitForTimeout(200);
    const bal = await page.locator('.totals').textContent();
    if (!bal.includes('ดุล ✓')) throw new Error('not balanced: ' + bal);
    await shot('07-journal-new');
    await page.keyboard.press('F9');
    await page.waitForURL(/\/gl\/journals\/[0-9a-f-]{36}$/, { timeout: 10000 });
    await page.waitForFunction(() => /^JV/.test(document.querySelector('.doc-title h1')?.textContent ?? ''), null, { timeout: 10000 });
    newNo = (await page.locator('.doc-title h1').textContent()).trim();
    if (!/^JV691015\d{3}$/.test(newNo)) throw new Error('voucher no ' + newNo);
    await shot('08-journal-saved');
  });
  await step('cancel journal (Alt+C)', async () => {
    await page.keyboard.press('Alt+C');
    await page.waitForSelector('.modal');
    await page.locator('.modal input').fill('ทดสอบระบบ');
    await page.locator('.modal button.danger').click();
    await page.waitForSelector('.pill.st-c', { timeout: 8000 });
    await shot('08b-journal-cancelled');
  });
  await step('validation error shown', async () => {
    await page.goto(BASE + '/gl/journals/new');
    await page.waitForSelector('.lines tbody tr');
    await page.waitForLoadState('networkidle');   // รอผังบัญชีโหลดก่อนพิมพ์เลขที่บัญชี (ไม่งั้นหน้าต่างค้นหาเปิด)
    const acc = page.locator('.lines tbody tr').nth(0).locator('.lk-in input');
    await acc.fill('5390-01'); await acc.press('Enter');
    await page.locator('.lines tbody tr').nth(0).locator('input.num').nth(0).fill('100');
    await page.locator('.lines tbody tr').nth(0).locator('input.num').nth(0).press('Tab');
    await page.keyboard.press('F9');
    await page.waitForSelector('.errbox', { timeout: 5000 });
    await shot('09-journal-error');
  });
  await step('trial balance', async () => {
    await page.goto(BASE + '/reports/trial-balance?from=2026-01-01&to=2026-12-31');
    await page.waitForSelector('table.report tfoot', { timeout: 20000 });
    const foot = await page.locator('table.report tfoot').textContent();
    if (!(await page.locator('.pill.st-m', { hasText: 'ดุล' }).count())) throw new Error('TB not balanced: ' + foot);
    await shot('10-tb');
    await page.locator('table.report tbody tr.row-open').nth(5).click();
    await page.waitForSelector('table.report tbody tr.sub', { timeout: 15000 });
    await shot('11-ledger');
  });
  await step('statements chart BS', async () => {
    await page.goto(BASE + '/fs/statements?kind=BS');
    await page.waitForSelector('.paper.statement tr.total', { timeout: 20000 });
    await shot('12-bs');
  });
  await step('statements express layout', async () => {
    await page.goto(BASE + '/fs/layouts');
    await page.waitForSelector('table.grid tbody tr.row-open');
    await shot('13-layouts');
    await page.locator('table.grid tbody tr.row-open', { hasText: 'INCS_P1' }).locator('button', { hasText: 'พิมพ์งบ' }).click();
    await page.waitForSelector('.paper.statement tr.total', { timeout: 20000 });
    await shot('14-incs');
    await page.goto(BASE + '/fs/layouts');
    await page.waitForSelector('table.grid tbody tr.row-open');
    await page.locator('table.grid tbody tr.row-open', { hasText: 'BALS_P1' }).click();
    await page.waitForSelector('.fs-lines tbody tr');
    await shot('15-layout-editor');
    await page.keyboard.press('Escape');
  });
  await step('journal templates (S-GL-01/05)', async () => {
    await page.goto(BASE + '/gl/templates');
    await page.waitForSelector('table.grid tbody tr.row-open', { timeout: 15000 });
    await shot('15b-templates');
    // ใบสำคัญใหม่: 🔍 ที่ช่องเลขที่ → เลือกต้นแบบแรก → บรรทัดต้องเติมจากต้นแบบ (ไม่บันทึก)
    // ต้นแบบตัวอย่างของ TESTRice อ้างบัญชีที่ไม่มีในผัง จึงตรวจคำอธิบายรายการแทนเลขที่บัญชี
    await page.goto(BASE + '/gl/journals/new');
    await page.waitForSelector('.lines tbody tr');
    await page.locator('button[title^="เลือกต้นแบบวิธีการบันทึก"]').click();
    await page.waitForSelector('.modal tbody tr.row-open');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.lines tbody tr')].filter((tr) => tr.querySelector('td:nth-child(5) input')?.value).length >= 2, null, { timeout: 15000 });
    await shot('15c-journal-from-template');
  });
  await step('copy from another voucher (Ctrl+F6, S-GL-06)', async () => {
    await page.goto(BASE + '/gl/journals/new');
    await page.waitForSelector('.lines tbody tr');
    await page.keyboard.press('Control+F6');
    await page.waitForSelector('.modal tbody tr.row-open', { timeout: 15000 });
    const no = (await page.locator('.modal tbody tr.sel td').first().textContent()).trim();
    await shot('15d-copy-picker');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.lines tbody .lk-in input')].filter((i) => i.value).length >= 2, null, { timeout: 15000 });
    const toastText = await page.locator('.toast').last().textContent();
    if (!toastText.includes(no)) throw new Error('toast ' + toastText);
    await shot('15e-journal-copied');
  });
  await step('prior-year balances (S-GL-16)', async () => {
    // DEMO: ปี 2568 มีใบสำคัญ → แสดงยอดรายงวดจากใบสำคัญ ดูอย่างเดียว (ไม่บันทึก)
    await page.goto(BASE + '/gl/prior-year');
    await page.waitForSelector('table.grid tbody tr', { timeout: 15000 });
    await shot('15f-prior-year');
    await page.keyboard.press('Insert');
    await page.waitForSelector('.modal');
    await page.waitForTimeout(500);
    await page.keyboard.type('1111-00'); await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    if (await page.locator('.modal .lk-table').count()) await page.keyboard.press('Enter');
    await page.waitForSelector('.modal tbody tr:nth-child(13)', { timeout: 15000 });
    await shot('15g-prior-year-entry');
    await page.keyboard.press('Escape');
  });
  await step('budget (S-GL-17)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: เปิดหน้าต่างป้อนงบประมาณของเงินสด ต้องเห็น 12 งวดพร้อมยอดจริง
    await page.goto(BASE + '/gl/budget');
    await page.waitForSelector('table.grid tbody tr', { timeout: 15000 });
    await page.keyboard.press('Insert');
    await page.waitForSelector('.modal');
    await page.waitForTimeout(500);
    await page.keyboard.type('1111-00'); await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    if (await page.locator('.modal .lk-table').count()) await page.keyboard.press('Enter');
    await page.waitForSelector('.modal tbody tr:nth-child(12)', { timeout: 15000 });
    await shot('15h-budget-entry');
    await page.keyboard.press('Escape');
  });
  await step('account detail report (R-GL-01)', async () => {
    await page.goto(BASE + '/reports/account-detail');
    const acc = page.locator('.filters .lk-in input');
    await acc.waitFor();
    await page.waitForTimeout(800);
    await acc.fill('1000-00'); await acc.press('Enter');
    await page.waitForTimeout(800);
    if (await page.locator('.modal .lk-table').count()) await page.keyboard.press('Enter');
    await page.waitForSelector('table.grid tbody tr.row-open', { timeout: 15000 });
    const n = await page.locator('table.grid tbody tr.row-open').count();
    if (n < 20) throw new Error('detail rows ' + n);
    await shot('15i-account-detail');
    await page.locator('table.grid tbody tr.row-open').nth(3).click();
    await page.waitForURL(/\/reports\/ledger\?account_id=/, { timeout: 15000 });
  });
  await step('menu permissions (S-SEC-01/02/03)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: เลือกกลุ่ม/ผู้ใช้แรก ต้องเห็นตารางสิทธิ์ทุกเมนู และมุมมองตามเมนู
    await page.goto(BASE + '/settings/permissions');
    const sel = page.locator('.filters select').first();
    await sel.waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const first = (await sel.locator('option').count()) > 1 ? await sel.locator('option').nth(1).getAttribute('value') : null;
    if (first) {
      await sel.selectOption(first);
      await page.waitForSelector('table.grid tbody tr:nth-child(40)', { timeout: 15000 });
    } else await page.waitForSelector('.notebox', { timeout: 15000 });   // ยังไม่มีกลุ่ม/ผู้ใช้อื่นนอกจากผู้ดูแล
    await shot('15j-permissions');
    await page.getByRole('tab', { name: 'ตามเมนู (ระบบงานที่อนุญาต)' }).click();
    await page.waitForSelector('table.grid thead', { timeout: 15000 });
  });
  await step('system defaults (S-SET-02…11)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: เปิดทุกหมวด ต้องเห็นรายการค่าเริ่มต้นตามคู่มือบทที่ 5
    await page.goto(BASE + '/settings/defaults');
    await page.waitForSelector('.set-row', { timeout: 15000 });
    for (const t of ['ระบบสินค้าคงเหลือ', 'ระบบขายและลูกหนี้', 'ระบบซื้อและเจ้าหนี้', 'ระบบการเงินและเงินฝากธนาคาร', 'ระบบบัญชี', 'ระบบทรัพย์สินถาวร']) {
      await page.locator('.settings-nav button', { hasText: t }).click();
      await page.waitForFunction((x) => document.querySelector('h1')?.textContent?.includes(x), t, { timeout: 15000 });
    }
    await page.locator('.settings-nav button', { hasText: 'ระบบสินค้าคงเหลือ' }).click();
    await page.waitForSelector('.set-row', { timeout: 15000 });
    await shot('15k-defaults');
  });
  await step('customers / suppliers / salespersons (S-AR-01 / S-AP-01 / S-SO-01)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: รายการ → เปิดรายแรก → ทุกแท็บ → Esc
    for (const [url, tabs] of [['/ar/customers', ['ผู้ติดต่อ', 'บิลที่ค้างชำระ', 'สถานที่ส่งสินค้า', 'รายละเอียด']], ['/ap/suppliers', ['ผู้ติดต่อ', 'บัญชีธนาคาร', 'บิลที่ค้างชำระ', 'รายละเอียด']], ['/ar/salespersons', ['กำหนดเป้าการขาย', 'รายละเอียดทั่วไป']]]) {
      await page.goto(BASE + url);
      const row = page.locator('table.grid tbody tr.row-open').first();
      if (!(await row.count()) && !(await row.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) { await page.waitForSelector('td.empty', { timeout: 15000 }); continue; }
      await row.click();
      await page.waitForSelector('.modal .party-head input', { timeout: 15000 });
      for (const t of tabs) await page.getByRole('tab', { name: t }).click();
      await shot('15l-' + url.split('/').pop());
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
    }
    await page.goto(BASE + '/ar/customers');
    await page.locator('input[type=search]').fill('zzz-ไม่มี');
    await page.waitForSelector('td.empty', { timeout: 15000 });
  });
  await step('item master (S-IC-01/03/05/06/07, S-SO-02, S-AP-02, S-SET-04)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: ทุกชนิดรหัส เปิดรายการแรก ทุกแท็บ แล้ว Esc
    for (const url of ['/ic/items', '/ic/kits', '/ic/services', '/ar/other-incomes', '/ap/other-expenses', '/settings/item-account-groups']) {
      await page.goto(BASE + url);
      const row = page.locator('table.grid tbody tr.row-open').first();
      if (!(await row.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) { await page.waitForSelector('td.empty', { timeout: 10000 }); continue; }
      await row.click();
      await page.waitForSelector('.modal .form-grid input', { timeout: 15000 });
      for (const t of await page.locator('.modal [role=tab]').all()) await t.click();
      await shot('15n-' + url.split('/').pop());
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
    }
    await page.goto(BASE + '/ic/items');
    await page.locator('input[type=search]').fill('zzz-ไม่มี');
    await page.waitForSelector('td.empty', { timeout: 15000 });
    for (const url of ['/ic/prices', '/ic/reorder']) {
      await page.goto(BASE + url);
      const pick = page.locator('.toolbar .pick input');
      await pick.fill('A');
      await page.locator('.pick-list li[role=option]').first().click({ timeout: 15000 });
      await page.waitForSelector(url === '/ic/prices' ? 'fieldset.box' : 'table.grid', { timeout: 15000 });
      await shot('15o-' + url.split('/').pop());
    }
  });
  await step('bank accounts + receipt/payment methods (S-CQ-01, S-SET-06/08, view only)', async () => {
    await page.goto(BASE + '/fi/bank-accounts');
    await page.locator('table.grid tbody tr.row-open').first().click({ timeout: 15000 });
    await page.waitForSelector('.modal .form-grid input', { timeout: 15000 });
    await shot('15p-bank-account');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
    await page.goto(BASE + '/settings/payment-methods');
    await page.waitForSelector('.lines tbody tr input', { timeout: 15000 });
    await page.getByRole('tab', { name: /วิธีการจ่ายชำระหนี้/ }).click();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('จ่ายชำระ'), null, { timeout: 15000 });
    await page.waitForSelector('.lines tbody tr input', { timeout: 15000 });
    await shot('15p-payment-methods');
  });
  await step('document numbers + GL link (S-DN-01/02, S-GL-01/02, view only)', async () => {
    await page.goto(BASE + '/settings/doc-types');
    await page.locator('table.grid tbody tr.row-open').filter({ hasText: 'PO' }).first().click({ timeout: 15000 });
    await page.waitForSelector('.modal fieldset.box input', { timeout: 15000 });
    await shot('15q-doc-type');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
    await page.goto(BASE + '/settings/gl-link');
    await page.waitForSelector('fieldset.box select', { timeout: 15000 });
    await page.getByRole('tab', { name: /บัญชีเพื่อลงรายวัน/ }).click();
    await page.waitForSelector('fieldset.box .lk-in input, fieldset.box input', { timeout: 15000 });
    await shot('15q-gl-link');
  });
  await step('data tables (S-TBL-00/01, view only)', async () => {
    await page.goto(BASE + '/settings/data-tables');
    await page.waitForSelector('.lines tbody tr input', { timeout: 15000 });
    await page.locator('.tbl-nav button', { hasText: 'หมวดสินค้า' }).click();
    await page.waitForFunction(() => document.querySelector('.tbl-title')?.textContent?.includes('หมวดสินค้า'), null, { timeout: 15000 });
    await page.waitForSelector('.lines tbody tr input', { timeout: 15000 });
    await shot('15r-data-tables');
  });
  await step('sales/purchase documents (S-IV-01, S-PU-03, view only)', async () => {
    for (const url of ['/sa/invoices', '/pu/invoices']) {
      await page.goto(BASE + url);
      await page.waitForSelector('.toolbar input[type=search]', { timeout: 15000 });
      const from = page.locator('.toolbar .date-in input').first();
      await from.fill('01/01/2569'); await from.press('Enter');
      await page.locator('table.grid tbody tr.row-open').first().click({ timeout: 15000 });
      await page.waitForSelector('.trade-head', { timeout: 15000 });
      await page.getByRole('tab', { name: 'ใบสำคัญที่ลงบัญชี' }).click();
      await page.waitForSelector('div.box table, .muted', { timeout: 15000 });
      await shot('15s-' + url.split('/')[1] + '-doc');
    }
  });
  await step('receipts/payments + WHT register (S-RE-01, S-PU-07, S-TX-10, view only)', async () => {
    for (const url of ['/fi/ar/receipts', '/fi/ap/payments']) {
      await page.goto(BASE + url);
      await page.waitForSelector('.toolbar input[type=search]', { timeout: 15000 });
      const from = page.locator('.toolbar .date-in input').first();
      await from.fill('01/01/2550'); await from.press('Enter');
      await page.locator('table.grid tbody tr.row-open').first().click({ timeout: 15000 });
      await page.waitForSelector('.trade-head', { timeout: 15000 });
      await page.waitForSelector('.lines tbody tr.picked, .lines .empty', { timeout: 15000 });   // บิลที่ใบนี้ตัดแสดงเป็นแถวที่เลือก
      await page.getByRole('tab', { name: 'ใบสำคัญที่ลงบัญชี' }).click();
      await page.waitForSelector('div.box table, .muted', { timeout: 15000 });
      await shot('15t-' + url.split('/')[3] + '-doc');
    }
    await page.goto(BASE + '/tax/wht');
    await page.waitForSelector('table.grid tbody tr', { timeout: 15000 });
    await shot('15u-wht-register');
  });
  await step('deposits + other income/expense (S-AI-01, S-PU-02, S-OI-01, S-PU-08, view only)', async () => {
    for (const url of ['/pu/deposits', '/pu/other-expense', '/sa/deposits']) {
      await page.goto(BASE + url);
      await page.waitForSelector('.toolbar input[type=search]', { timeout: 15000 });
      const from = page.locator('.toolbar .date-in input').first();
      await from.fill('01/01/2550'); await from.press('Enter');
      await page.locator('table.grid tbody tr.row-open').first().click({ timeout: 15000 });
      await page.waitForSelector('.trade-head', { timeout: 15000 });
      await page.getByRole('tab', { name: 'ใบสำคัญที่ลงบัญชี' }).click();
      await page.waitForSelector('div.box table, .muted', { timeout: 15000 });
      await shot('15v-' + url.split('/')[2] + '-doc');
    }
    await page.goto(BASE + '/sa/other-income/new');
    await page.waitForSelector('.trade-head', { timeout: 15000 });
  });
  await step('WHT certificate 50 ทวิ (ภ.ง.ด.3/53)', async () => {
    // ดูอย่างเดียว ไม่บันทึก: ภาพแบบฟอร์มโหลดได้ ป้อนชื่อ/จำนวนเงิน แล้วข้อความลงช่องถูกต้อง
    await page.goto(BASE + '/tax/wht50');
    await page.waitForFunction(() => { const i = document.querySelector('.w50-preview img'); return i && i.complete && i.naturalWidth > 2000; }, null, { timeout: 15000 });
    await page.locator('.w50-editor fieldset').nth(1).locator('input').nth(1).fill('นายทดสอบ ระบบ');
    const amt = page.locator('.w50-editor tbody tr').first().locator('input').nth(1);
    await amt.fill('1000'); await amt.press('Tab');
    await page.waitForFunction(() => document.querySelector('.w50-preview [data-key="tax.total.baht"]')?.textContent === '30', null, { timeout: 5000 });
    if ((await page.locator('.w50-print .w50-sheet').count()) !== 2) throw new Error('ต้องมีฉบับที่ 1 และ 2');
    await shot('15m-wht50');
  });
  await step('periods', async () => { await page.goto(BASE + '/settings/periods'); await page.waitForSelector('.period-cell'); await shot('16-periods'); });
  await step('company', async () => { await page.goto(BASE + '/settings/company'); await page.waitForSelector('.card .field input'); await shot('17-company'); });
  await step('planned menu', async () => { await page.goto(BASE + '/planned/SA.IV'); await page.waitForSelector('.notebox'); await shot('18-planned'); });
  await step('mobile', async () => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(BASE + '/gl/journals/new'); await page.waitForSelector('.lines'); await shot('19-mobile');
    const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 400) throw new Error('horizontal overflow ' + w); });
  console.log('new voucher', newNo);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
