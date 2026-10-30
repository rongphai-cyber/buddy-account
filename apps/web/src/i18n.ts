import { makeTranslator, type Translator } from '@buddy/core';

/**
 * สลับ 2 ภาษา (ข้อกำหนดเจ้าของข้อ 9) — หน้าจอเขียนเป็นภาษาไทย ชั้นนี้แปลข้อความที่แสดงเป็นภาษาอังกฤษเมื่อเลือก EN
 * แปลทั้งข้อความในหน้า ป้าย/คำแนะนำ (placeholder title aria-label) และข้อความแจ้งจาก server
 * ไม่แปล: สิ่งที่ผู้ใช้พิมพ์ (input/textarea) เอกสารพิมพ์ (ใช้ภาษาตามแบบฟอร์ม) และส่วนที่ติด data-no-i18n
 * พจนานุกรม apps/web/src/i18n/en.json โหลดเฉพาะเมื่อเลือกภาษาอังกฤษ
 */
export type Lang = 'th' | 'en';
const KEY = 'buddy.lang';
export function getLang(): Lang { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'th'; } catch { return 'th'; } }
/** เปลี่ยนภาษาแล้วโหลดหน้าใหม่ (คืนข้อความเดิมครบทุกจุด) */
export function setLang(l: Lang) { try { localStorage.setItem(KEY, l); } catch { /* ไม่มีที่เก็บ */ } location.reload(); }

const SKIP = 'input, textarea, script, style, [contenteditable="true"], [data-no-i18n], .doc-sheet, .doc-print, .ds-preview, .w50-sheet, .w50-print, .w50-preview, .paper, .print-only';
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const TH = /[฀-๿]/;
/** ข้อความที่เราเขียนแทน (เพื่อรู้ว่า React เปลี่ยนเป็นข้อความใหม่หรือยัง) */
const mine = new WeakMap<Node, { src: string; out: string }>();
const attrMine = new WeakMap<Element, Record<string, string>>();

let tr: Translator | null = null;
const skipped = (el: Element | null) => !el || !!el.closest(SKIP);
const sourceOf = (n: Node) => { const m = mine.get(n); return m && n.nodeValue === m.out ? m.src : n.nodeValue ?? ''; };
const write = (n: Node, src: string, out: string) => { mine.set(n, { src, out }); if (n.nodeValue !== out) n.nodeValue = out; };

function doText(n: Text) {
  const v = n.nodeValue;
  if (!v || !TH.test(v) || skipped(n.parentElement)) return;
  // ข้อความที่เราเพิ่งเขียนเอง (คำแปลที่ยังมีคำไทยของข้อมูลปนอยู่) ไม่แปลซ้ำ — กันวนไม่รู้จบ
  if (mine.get(n)?.out === v) return;
  // คำเดียวกันแปลต่างกันตามที่อยู่ เช่น กลุ่มเมนู "ซื้อ" = Purchasing (ในตาราง = Purchase)
  const ctx = n.parentElement!.closest('.sidebar, .menu-search-list') ? tr!.exact(`menu|${v}`) : null;
  const out = ctx !== null ? v.replace(v.trim(), ctx) : tr!.tr(v);
  if (out !== null) { write(n, v, out); return; }
  // ข้อความใน JSX ที่ React แยกเป็นหลายท่อน เช่น ลบ{ชื่อ}แล้ว หรือ "+ เพิ่ม{ชื่อ} <kbd>Ins</kbd>" → รวมท่อนข้อความที่ติดกันแล้วแปลครั้งเดียว
  const sib = [...n.parentElement!.childNodes];
  const at = sib.indexOf(n);
  let a = at, b = at;
  while (a > 0 && sib[a - 1]!.nodeType === Node.TEXT_NODE) a--;
  while (b < sib.length - 1 && sib[b + 1]!.nodeType === Node.TEXT_NODE) b++;
  const kids = sib.slice(a, b + 1);
  if (kids.length < 2 || kids.length > 12) return;
  const joined = kids.map(sourceOf).join('');
  const all = tr!.tr(joined);
  if (all === null) return;
  kids.forEach((k, i) => write(k, sourceOf(k), i === 0 ? all : ''));
}
function doAttrs(el: Element) {
  if (skipped(el) && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || !TH.test(v)) continue;
    const done = attrMine.get(el) ?? attrMine.set(el, {}).get(el)!;
    if (done[a] === v) continue;
    const out = tr!.tr(v);
    if (out !== null) { done[a] = out; el.setAttribute(a, out); }
  }
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (!(root instanceof Element)) return;
  doAttrs(root);
  if (root.closest(SKIP) && !root.matches('input, textarea')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

/** เริ่มแปลหน้าจอ (เรียกครั้งเดียวตอนเปิดโปรแกรม) — ภาษาไทยไม่ต้องทำอะไร */
export async function startI18n() {
  const lang = getLang();
  document.documentElement.lang = lang;
  if (lang !== 'en') return;
  const dict = (await import('./i18n/en.json')).default as Record<string, string>;
  tr = makeTranslator(dict);
  const fixTitle = () => { const o = tr!.tr(document.title); if (o) document.title = o; };
  walk(document.body); fixTitle();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  new MutationObserver(fixTitle).observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true });
}
