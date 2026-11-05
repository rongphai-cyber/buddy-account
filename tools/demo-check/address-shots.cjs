// ภาพหน้าจอที่อยู่แยกช่อง + รหัสไปรษณีย์ (docs/18 ข้อ 12) — ไม่บันทึกข้อมูล
// ใช้: BASE=http://localhost:4101 PASS=... OUT=<โฟลเดอร์> node tools/demo-check/address-shots.cjs
const { chromium } = require(require('path').resolve(__dirname, '../../apps/web/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:4101';
const OUT = process.env.OUT || 'address-shots';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const run = async (width, height, tag) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: false });
    await page.goto(BASE + '/');
    await page.fill('input[autocomplete=username]', process.env.USER_NAME || 'admin');
    await page.fill('input[type=password]', process.env.PASS || '');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.kpis', { timeout: 20000 });

    // ลูกค้าใหม่: กรอกรหัสไปรษณีย์ 50230 → เชียงใหม่ · หางดง · รายการตำบลของรหัสนี้
    await page.goto(BASE + '/ar/customers');
    await page.waitForSelector('table.grid', { timeout: 20000 });
    await page.keyboard.press('Insert');
    await page.waitForSelector('.modal .addr-box input[placeholder="เช่น 50230"]', { timeout: 20000 });
    await page.fill('.modal input[autofocus], .modal .party-head input.mono', 'TADDR');
    const zip = page.locator('.modal .addr-box input[placeholder="เช่น 50230"]');
    await zip.fill('50230');
    await page.waitForTimeout(300);
    const sel = page.locator('.modal .addr-box select');
    const prov = await sel.nth(0).evaluate((s) => s.options[s.selectedIndex].text);
    const amph = await sel.nth(1).evaluate((s) => s.options[s.selectedIndex].text);
    const tambs = await sel.nth(2).evaluate((s) => [...s.options].map((o) => o.text));
    if (prov !== 'เชียงใหม่' || amph !== 'หางดง' || !tambs.includes('สันผักหวาน')) errors.push(`${tag}: 50230 → ${prov} / ${amph} / ${tambs.join(',')}`);
    console.log(tag, '50230 →', prov, '/', amph, '/', tambs.length - 1, 'ตำบล');
    await shot('1-postcode-50230');
    // Enter จากรหัสไปรษณีย์ → ข้ามจังหวัด/อำเภอที่เติมแล้ว → ช่องตำบล
    await zip.focus();
    await page.keyboard.press('Enter');
    const focused = await page.evaluate(() => document.activeElement?.closest('label')?.querySelector('.lbl')?.textContent);
    if (!/ตำบล/.test(focused || '')) errors.push(`${tag}: Enter after postcode went to "${focused}"`);
    await sel.nth(2).selectOption({ label: 'สันผักหวาน' });
    const inputs = page.locator('.modal .addr-box .addr-grid input');
    await inputs.nth(1).fill('99/1');
    await inputs.nth(2).fill('5');
    await inputs.nth(8).fill('เชียงใหม่-ฮอด');
    await page.waitForTimeout(200);
    const lines = await page.locator('.modal .addr-out input').evaluateAll((xs) => xs.map((x) => x.value));
    console.log(tag, 'lines:', lines.join(' | '));
    if (lines[1] !== 'ตำบลสันผักหวาน อำเภอหางดง' || lines[2] !== 'จังหวัดเชียงใหม่' || !lines[0].startsWith('99/1 หมู่ 5')) errors.push(`${tag}: composed ${lines.join(' | ')}`);
    await page.locator('.modal .addr-box').scrollIntoViewIfNeeded();
    await shot('2-filled');
    // รหัสไม่มีจริง → เตือนติดช่อง
    await zip.fill('99999');
    await page.waitForTimeout(200);
    if (!(await page.locator('.modal .addr-box .err-msg').count())) errors.push(`${tag}: no warning for 99999`);
    await shot('3-unknown-postcode');
    // แท็บย่อย
    await page.locator('.modal .tabs button, .modal [role=tab]').filter({ hasText: 'การขายและเครดิต' }).first().click();
    await shot('4-tab-sale');
    // ข้อมูลหลักเพิ่มจากช่อง: ช่องประเภทลูกค้า กด Insert → หน้าต่างเพิ่มเร็ว (ไม่บันทึก)
    const typeSel = page.locator('.modal label.field').filter({ hasText: 'ประเภทลูกค้า' }).locator('select');
    await typeSel.focus();
    await page.keyboard.press('Insert');
    await page.waitForSelector('.modal >> text=เพิ่มประเภทลูกค้า', { timeout: 5000 }).catch(() => errors.push(`${tag}: Insert did not open quick add`));
    await shot('4b-quick-add');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (!(await page.locator('.modal .party-head').count())) errors.push(`${tag}: Esc on quick add closed the customer form too`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.locator('.modal').count()) { await page.keyboard.press('Escape'); }

    // รายละเอียดกิจการ (แท็บย่อย + ที่อยู่กิจการ)
    await page.goto(BASE + '/settings/company');
    await page.waitForSelector('.addr-box', { timeout: 20000 });
    await shot('5-company');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 1) errors.push(`${tag}: company page scrolls sideways ${sw}px`);
    await page.close();
  };
  await run(1440, 900, 'desktop');
  await run(768, 1024, 'tablet');
  await run(390, 844, 'phone');
  await browser.close();
  if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exit(1); }
  console.log('address shots ok');
})();
