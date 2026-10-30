// ตรวจทุกหน้าจอบนมือถือ/แท็บเล็ต (ข้อกำหนดเจ้าของข้อ 10) — เปิดทุกเมนูที่มีหน้าจอ ที่ความกว้างมือถือและแท็บเล็ต
// ตรวจ: หน้าเลื่อนซ้ายขวา (ล้นจอ), สิ่งที่โผล่เกินขอบจอ (ไม่นับตารางที่เลื่อนในกรอบของตัวเอง), ข้อผิดพลาดของหน้า,
// หน้าต่างเพิ่มรายการ (กด Ins) — อ่านอย่างเดียว ไม่บันทึกอะไร
// ใช้: PASS=… BASE=http://127.0.0.1:4100 OUT=<โฟลเดอร์ภาพ> node tools/demo-check/mobile-sweep.cjs [รหัสเมนู…]
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../apps/web/node_modules/playwright'));
const BASE = process.env.BASE ?? 'http://127.0.0.1:4100', OUT = process.env.OUT, USER = process.env.USER_NAME ?? 'admin', PASS = process.env.PASS;
if (!PASS) { console.error('ต้องตั้ง PASS'); process.exit(2); }
const menuSrc = fs.readFileSync(path.resolve(__dirname, '../../packages/core/src/menu.ts'), 'utf8');
const only = process.argv.slice(2);
const routes = [...menuSrc.matchAll(/m\('([A-Z.]+)', '([^']+)', 'P\d', '([^']+)'/g)].map((m) => ({ code: m[1], label: m[2], route: m[3] }))
  .filter((r) => !only.length || only.includes(r.code));
const SIZES = [{ name: 'มือถือ', w: 390, h: 844 }, { name: 'แท็บเล็ต', w: 768, h: 1024 }];

/** สิ่งที่โผล่เกินขอบขวา (ไม่นับที่อยู่ในกรอบเลื่อนซึ่งกรอบเองพอดีจอ) */
const measure = () => {
  const W = window.innerWidth;
  // กรอบเลื่อนที่ตั้งใจ (ตาราง แท็บ บรรทัดเอกสาร) — ไม่นับพื้นที่หน้า (.main) และตัวหน้าต่าง (.modal-body) ซึ่งต้องพอดีจอเอง
  const PAGE = (p) => p.matches('.main, .modal-body, .modal, .modal-back, #app, .shell');
  const scrollBox = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (PAGE(p)) return null; const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return p; } return null; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= W + 1 || getComputedStyle(el).position === 'fixed' && r.left > W) continue;
    if (el.closest('.hp-field, .sidebar, .burger') || el.closest('[aria-hidden="true"]')) continue;
    const box = scrollBox(el);
    if (box && box.getBoundingClientRect().right <= W + 1) continue;
    // รายงานเฉพาะตัวนอกสุดที่ล้น
    if (el.parentElement && el.parentElement.getBoundingClientRect().right > W + 1 && !scrollBox(el.parentElement)?.contains(el)) { /* ให้ตัวแม่รายงาน */ }
    bad.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} →${Math.round(r.right)}px`);
  }
  return { docW: document.documentElement.scrollWidth, W, bad: [...new Set(bad)].slice(0, 6), err: document.querySelector('.errbox')?.innerText.slice(0, 120) ?? null };
};

(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const sz of SIZES) {
    const ctx = await b.newContext({ viewport: { width: sz.w, height: sz.h }, isMobile: sz.w < 700, hasTouch: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/'); await p.fill('input[autocomplete=username]', USER); await p.fill('input[type=password]', PASS); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
    // ปุ่ม ☰ ต้องเปิดเมนูให้เห็นเต็มในจอ และไม่บังแถบบน
    if (await p.locator('button.burger').isVisible()) {
      await p.locator('button.burger').click(); await p.waitForTimeout(500);
      const nav = await p.evaluate(() => { const s = document.querySelector('.sidebar').getBoundingClientRect(), t = document.querySelector('.topbar').getBoundingClientRect(); return { left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top), bar: Math.round(t.bottom), W: window.innerWidth }; });
      const ok = nav.left >= 0 && nav.right <= nav.W && nav.right > 100 && Math.abs(nav.top - nav.bar) <= 2;
      report.push({ size: sz.name, w: sz.w, code: 'MENU', label: 'ปุ่ม ☰ เปิดเมนู', route: '/', docW: ok ? sz.w : 9999, bad: ok ? [] : [`เมนู ${JSON.stringify(nav)}`], err: null, pageErrors: [], modal: null });
      process.stdout.write(ok ? '.' : '✗');
      await p.locator('button.burger').click(); await p.waitForTimeout(300);
    }
    for (const r of routes) {
      errs.length = 0;
      try { await p.goto(BASE + r.route, { waitUntil: 'networkidle', timeout: 20000 }); } catch { /* หน้าโหลดนาน */ }
      await p.waitForTimeout(500);
      const m = await p.evaluate(measure);
      let modal = null;
      // หน้าต่างเพิ่มรายการ (Ins) ถ้ามี
      await p.keyboard.press('Insert').catch(() => {}); await p.waitForTimeout(700);
      if (await p.locator('.modal').count()) {
        modal = await p.evaluate(measure);
        if (OUT && (modal.docW > modal.W + 1 || modal.bad.length)) await p.screenshot({ path: path.join(OUT, `${sz.w}-${r.code}-ins.png`) });
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        if (await p.locator('.modal').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
      }
      const problem = m.docW > m.W + 1 || m.bad.length || errs.length || (modal && (modal.docW > modal.W + 1 || modal.bad.length));
      if (OUT && problem) await p.screenshot({ path: path.join(OUT, `${sz.w}-${r.code}.png`), fullPage: false });
      report.push({ size: sz.name, w: sz.w, code: r.code, label: r.label, route: r.route, docW: m.docW, bad: m.bad, err: m.err, pageErrors: [...errs], modal: modal && { docW: modal.docW, bad: modal.bad } });
      process.stdout.write(problem ? '✗' : '.');
    }
    await ctx.close();
  }
  await b.close();
  console.log();
  const probs = report.filter((x) => x.docW > x.w + 1 || x.bad.length || x.pageErrors.length || (x.modal && (x.modal.docW > x.w + 1 || x.modal.bad.length)));
  for (const x of probs) console.log(`✗ ${x.size} ${x.code} ${x.label} (${x.route}) หน้า ${x.docW}px${x.bad.length ? ' ล้น: ' + x.bad.join(', ') : ''}${x.modal && (x.modal.docW > x.w + 1 || x.modal.bad.length) ? ` | หน้าต่าง ${x.modal.docW}px ${x.modal.bad.join(', ')}` : ''}${x.pageErrors.length ? ' | error: ' + x.pageErrors[0] : ''}`);
  const apiErr = report.filter((x) => x.err);
  for (const x of apiErr) console.log(`! ${x.size} ${x.code} ข้อความผิดพลาด: ${x.err.replace(/\s+/g, ' ')}`);
  console.log(`ตรวจ ${routes.length} หน้าจอ × ${SIZES.length} ขนาด = ${report.length} · มีปัญหา ${probs.length}`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'mobile-report.json'), JSON.stringify(report, null, 1));
  process.exit(probs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(2); });
