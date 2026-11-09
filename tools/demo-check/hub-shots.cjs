// ภาพหน้าจอ WTS Solutions Hub (docs/17 B6.2) + ตรวจบัตรผ่านที่ได้จากการกดไทล์ POS
// ใช้กับสำเนาฐานทดสอบเท่านั้น (smoke-copy) — สคริปต์เปิดโมดูล POS/HR ของลูกค้า ตั้งที่อยู่ และสร้างกุญแจ API รายงานสถานะ
// ใช้: BASE=http://localhost:4101 PASS=... OUT=<โฟลเดอร์> node tools/demo-check/hub-shots.cjs
const { chromium } = require(require('path').resolve(__dirname, '../../apps/web/node_modules/playwright'));
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:4101';
const OUT = process.env.OUT || 'hub-shots';
const POS = 'https://pos.example.test/office/';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('https://pos.example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body><h1>WTS-POS (จำลอง)</h1></body></html>' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE + '/');
  await page.fill('input[autocomplete=username]', process.env.USER_NAME || 'admin');
  await page.fill('input[type=password]', process.env.PASS || '');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.kpis', { timeout: 30000 });
  const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, url, body]);

  // 1) ค่าเริ่มต้น: POS ยังไม่เปิด
  await page.click('button.hub-btn');
  await page.waitForSelector('.landing-card[data-app=buddy]', { timeout: 20000 });
  const keys = await page.locator('.landing-card').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-app')));
  // การ์ด: Buddy ก่อน · ที่ลูกค้ายังไม่เปิดใช้ ผู้ดูแลเห็นแบบจาง · Hotel/Spa (เร็ว ๆ นี้) อยู่บรรทัดท้าย ไม่ใช่การ์ด (09/11/2569)
  if (keys.join() !== 'buddy,pos,hr,living') errors.push(`tile order ${keys.join()}`);
  await page.screenshot({ path: `${OUT}/desktop-1-default.png` });

  // 2) เปิด POS + HR ให้ลูกค้าของบริษัทนี้ · ตั้งที่อยู่ · รายงานสถานะด้วยกุญแจ API
  const hub = (await api('GET', '/api/v1/hub')).body;
  const tenants = (await api('GET', '/api/v1/tenants')).body;
  const tenant = tenants.find((t) => t.code === hub.tenant.code);
  const put = await api('PUT', `/api/v1/tenants/${tenant.id}/modules`, { modules: [{ key: 'pos', enabled: true, app_url: POS }, { key: 'hr', enabled: true, app_url: 'https://sop.example.test/' }] });
  if (put.status !== 200) errors.push(`set modules ${put.status} ${JSON.stringify(put.body)}`);
  const me = (await api('GET', '/api/v1/auth/me')).body;
  const key = (await api('POST', '/api/v1/api-keys', { name: 'hub-shots status', user_id: me.user.id })).body.key;
  const rep = await page.evaluate(async ([k]) => (await fetch('/api/v1/source-status', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` },
    body: JSON.stringify({ system: 'wts-pos', pending: 2, failed: 0, last_sent_at: new Date().toISOString(), metric: { label: 'ยอดขายวันนี้', value: '12345.00' } }) })).status, [key]);
  if (rep !== 200) errors.push(`status report ${rep}`);
  await page.reload();
  await page.waitForSelector('.landing-card[data-app=pos] .hub-metric', { timeout: 20000 });
  const posText = await page.locator('.landing-card[data-app=pos]').innerText();
  if (!posText.includes('฿12,345.00') || !posText.includes('รอส่งเข้าบัญชี 2 รายการ')) errors.push(`pos tile: ${posText}`);
  await page.screenshot({ path: `${OUT}/desktop-2-pos-on.png` });

  // 3) กดไทล์ POS → แท็บใหม่ที่ #buddy_sso=… · ตรวจลายเซ็นด้วย JWKS
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('.landing-card[data-app=pos]')]);
  await tab.waitForLoadState();
  await tab.waitForFunction(() => location.hash.includes('buddy_sso='), null, { timeout: 10000 }).catch(() => {});
  const url = tab.url();
  const token = url.split('#buddy_sso=')[1];
  if (!url.startsWith(POS) || !token) errors.push(`launch url ${url.slice(0, 80)}`);
  else {
    const jwks = (await api('GET', '/.well-known/jwks.json')).body;
    const [h, p, s] = token.split('.');
    const head = JSON.parse(Buffer.from(h, 'base64url'));
    const jwk = jwks.keys.find((k) => k.kid === head.kid);
    const ok = jwk && crypto.verify(null, Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' }), Buffer.from(s, 'base64url'));
    const c = JSON.parse(Buffer.from(p, 'base64url'));
    console.log('token', { ok, aud: c.aud, sub: c.sub === me.user.id, company: c.buddy.company.code, life: c.exp - c.iat });
    if (!ok || c.aud !== 'wts-pos' || c.sub !== me.user.id || c.buddy.company.id !== me.company.id || c.exp - c.iat !== 120) errors.push('token check failed');
  }
  await tab.close();

  // 4) ขนาดจออื่น
  for (const [w, h, tag] of [[768, 1024, 'tablet'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await page.waitForSelector('.landing-card[data-app=pos] .hub-metric', { timeout: 20000 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 1) errors.push(`${tag}: hub scrolls sideways ${sw}px`);
    await page.screenshot({ path: `${OUT}/${tag}-hub.png`, fullPage: true });
  }
  await browser.close();
  if (errors.length) { console.log('ERRORS\n' + errors.join('\n')); process.exit(1); }
  console.log('hub shots ok');
})();
