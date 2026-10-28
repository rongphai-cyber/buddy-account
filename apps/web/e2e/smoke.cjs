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
  await step('journals list', async () => {
    await page.goto(BASE + '/gl/journals?from=2010-12-01&to=2010-12-31');
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
    await date.fill('15/12/2553'); await date.press('Enter');
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
    if (!/^JV531215\d{3}$/.test(newNo)) throw new Error('voucher no ' + newNo);
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
    const acc = page.locator('.lines tbody tr').nth(0).locator('.lk-in input');
    await acc.fill('5390-01'); await acc.press('Enter');
    await page.locator('.lines tbody tr').nth(0).locator('input.num').nth(0).fill('100');
    await page.locator('.lines tbody tr').nth(0).locator('input.num').nth(0).press('Tab');
    await page.keyboard.press('F9');
    await page.waitForSelector('.errbox', { timeout: 5000 });
    await shot('09-journal-error');
  });
  await step('trial balance', async () => {
    await page.goto(BASE + '/reports/trial-balance?from=2010-01-01&to=2010-12-31');
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
