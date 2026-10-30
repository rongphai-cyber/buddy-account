// ตรวจภาษาอังกฤษทุกหน้าจอ (สลับ 2 ภาษา — ข้อกำหนดเจ้าของข้อ 9): เปิดทุกเมนูในโหมด EN + หน้าต่างเพิ่มรายการ (Ins)
// เก็บข้อความภาษาไทยที่ยังเหลือ (ไม่นับช่องกรอก เอกสารพิมพ์ และข้อมูลในเซลล์ตาราง td ซึ่งเป็นข้อมูลของผู้ใช้)
// ใช้: PASS=… BASE=http://127.0.0.1:4100 OUT=<โฟลเดอร์> node tools/demo-check/i18n-sweep.cjs [รหัสเมนู…]
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../apps/web/node_modules/playwright'));
const BASE = process.env.BASE ?? 'http://127.0.0.1:4100', OUT = process.env.OUT, PASS = process.env.PASS;
const menuSrc = fs.readFileSync(path.resolve(__dirname, '../../packages/core/src/menu.ts'), 'utf8');
const only = process.argv.slice(2);
const routes = [...menuSrc.matchAll(/m\('([A-Z.]+)', '([^']+)', 'P\d', '([^']+)'/g)].map((m) => ({ code: m[1], route: m[3] })).filter((r) => !only.length || only.includes(r.code));

const leftovers = () => {
  const SKIP = 'input, textarea, script, style, [data-no-i18n], .doc-sheet, .doc-print, .ds-preview, .w50-sheet, .w50-preview, .paper, option, .company-sel';
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const v = n.nodeValue.trim();
    // ข้อความตรงในเซลล์ td = ข้อมูลของผู้ใช้ (ชื่อลูกค้า ชื่อบัญชี) ไม่นับ
    if (!v || !/[฀-๿]/.test(v) || n.parentElement.closest(SKIP) || n.parentElement.tagName === 'TD') continue;
    const r = n.parentElement.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    out.push(v.replace(/\s+/g, ' ').slice(0, 200));
  }
  for (const el of document.querySelectorAll('[placeholder], [title], [aria-label]')) for (const a of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute(a); if (v && /[฀-๿]/.test(v) && !el.closest('[data-no-i18n]')) out.push(`@${a}: ${v}`); }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('buddy.lang', 'en'); } catch {} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(1200);
  const login = await p.evaluate(leftovers);
  await p.fill('input[autocomplete=username]', process.env.USER_NAME ?? 'admin'); await p.fill('input[type=password]', PASS); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
  const seen = new Map();
  const add = (list, where) => { for (const t of list) { const e = seen.get(t) ?? { t, n: 0, where: [] }; e.n++; if (e.where.length < 3 && !e.where.includes(where)) e.where.push(where); seen.set(t, e); } };
  add(login, 'login');
  let pages = 0, clean = 0;
  for (const r of routes) {
    try { await p.goto(BASE + r.route, { waitUntil: 'networkidle', timeout: 20000 }); } catch { /* ช้า */ }
    await p.waitForTimeout(500);
    const l = await p.evaluate(leftovers); add(l, r.code); pages++; if (!l.length) clean++;
    await p.keyboard.press('Insert').catch(() => {}); await p.waitForTimeout(600);
    if (await p.locator('.modal').count()) { add(await p.evaluate(leftovers), r.code + ':Ins'); await p.keyboard.press('Escape'); await p.waitForTimeout(300); if (await p.locator('.modal').count()) await p.keyboard.press('Escape'); }
    process.stdout.write(l.length ? '·' : '.');
  }
  await b.close();
  const rows = [...seen.values()].sort((a, b) => b.n - a.n);
  console.log(`\nหน้าจอ ${pages} · ไม่มีภาษาไทยเหลือ ${clean} · ข้อความไทยที่เหลือ (ไม่ซ้ำ) ${rows.length} · page errors ${errs.length}`);
  for (const r of rows.slice(0, 40)) console.log(`${r.n}\t${r.t.slice(0, 90)}\t[${r.where.join(' ')}]`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'i18n-leftovers.json'), JSON.stringify(rows, null, 1));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
})().catch((e) => { console.error('FAIL', e.message); process.exit(2); });
