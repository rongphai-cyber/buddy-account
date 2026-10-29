// วาดแบบฟอร์มหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ของกรมสรรพากรเป็นภาพพื้นหลัง (ไม่มีค่าตัวอย่างในช่องกรอก)
// ใช้: node tools/forms/render_wht50.mjs   → apps/web/public/forms/wht50.png (A4, 300 dpi)
// ต้นฉบับ: docs/50ทวิ.pdf (แบบฟอร์มกรอกได้ของกรมสรรพากร — เจ้าของเก็บไว้ในเครื่อง ไม่อยู่ใน git) — ตำแหน่งช่องกรอกอยู่ใน packages/core/src/forms/wht50.ts
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = createRequire(join(ROOT, 'apps/web/package.json'))('playwright');
const PDFJS = join(ROOT, 'node_modules/pdfjs-dist/build');
const DPI = 300;

const files = {
  '/pdf.mjs': [readFileSync(join(PDFJS, 'pdf.mjs')), 'text/javascript'],
  '/pdf.worker.mjs': [readFileSync(join(PDFJS, 'pdf.worker.mjs')), 'text/javascript'],
  '/form.pdf': [readFileSync(join(ROOT, 'docs/50ทวิ.pdf')), 'application/pdf'],
  '/': [Buffer.from('<!doctype html><canvas id="c"></canvas>'), 'text/html'],
};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://form.local/**', (r) => {
  const f = files[new URL(r.request().url()).pathname];
  return f ? r.fulfill({ body: f[0], contentType: f[1] }) : r.fulfill({ status: 404 });
});
await page.goto('http://form.local/');
const dataUrl = await page.evaluate(async (scale) => {
  const pdfjs = await import('/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const doc = await pdfjs.getDocument('/form.pdf').promise;
  const pg = await doc.getPage(1);
  const vp = pg.getViewport({ scale });
  const c = document.getElementById('c');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  // ไม่วาดช่องกรอก (annotation) — ได้เฉพาะตัวแบบฟอร์ม ไม่มีค่าตัวอย่างและปุ่ม Clear Data
  await pg.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  return c.toDataURL('image/png');
}, DPI / 72);
await browser.close();
const out = join(ROOT, 'apps/web/public/forms/wht50.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('เขียน', out);
