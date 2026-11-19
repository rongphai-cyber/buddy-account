import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * พิมพ์ในกรอบแยก (iframe) — HANDOFF 151 (เจ้าของ: กดพิมพ์บนคลาวด์ ตัวอย่างก่อนพิมพ์ว่างเปล่า)
 *
 * เดิมแผ่นเอกสารอยู่ในหน้าโปรแกรม (portal ที่ body) แล้วเอาออกเมื่อเบราว์เซอร์แจ้ง afterprint / หลัง window.print() คืนค่า
 * — ถ้าเบราว์เซอร์สร้าง/สร้างตัวอย่างใหม่หลังจากนั้น (window.print ไม่รอหน้าต่างพิมพ์ เปลี่ยนเครื่องพิมพ์/ขนาดกระดาษ) แผ่นเอกสารหายไปแล้ว
 * จึงได้หน้าว่าง (Chrome แสดงตัวเลือก "Layout" และกระดาษ Letter = ไม่มีแผ่นเอกสาร A4 ในหน้าขณะสร้างตัวอย่าง)
 *
 * ตอนนี้ (printHtml): คัดลอกแผ่นที่วาดเสร็จแล้ว (HTML) ไปไว้ในกรอบแยกที่มี CSS ของโปรแกรม (link/style ใน head) และสีธีมบริษัท
 * (style ของ html — theme.ts) · รอ CSS แบบอักษร และรูป (โลโก้/ลายเซ็น) ให้ครบ แล้วสั่งพิมพ์กรอบนั้น
 * กรอบมองไม่เห็นบนจอ (ขนาด 0 — display:none พิมพ์ไม่ได้ในบางเบราว์เซอร์) และอยู่จนกว่าจะพิมพ์ครั้งถัดไป
 * จึงไม่ขึ้นกับสถานะของหน้าจอ (React) และไม่กระทบ Ctrl+P ของหน้าจอ
 *
 * PrintJob = งานพิมพ์หนึ่งครั้ง: วาด children (แผ่นพร้อม class ของชนิดงานพิมพ์ เช่น doc-print / vat-print / pay-print)
 * ในที่ที่ไม่อยู่ในหน้า แล้วส่ง HTML ไป printHtml — onDone เรียกเมื่อสั่งพิมพ์แล้ว (ผู้เรียกเอางานพิมพ์ออกได้ทันที)
 */
let frame: HTMLIFrameElement | null = null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// wait for p or the timeout (an image/font that fails to load must not block printing)
const settle = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => undefined, () => undefined), wait(ms)]);

export async function printHtml(html: string, title = document.title): Promise<void> {
  frame?.remove();
  const f = document.createElement('iframe');
  f.className = 'print-frame';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.title = title;
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(f);
  frame = f;
  const doc = f.contentDocument!;
  const root = document.documentElement;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join('\n');
  const lang = esc(root.lang || 'th'), rootStyle = esc(root.getAttribute('style') ?? ''), theme = esc(root.dataset.theme ?? ''), origin = esc(location.origin), name = esc(title);
  doc.open();
  doc.write('<!doctype html><html lang="' + lang + '" style="' + rootStyle + '" data-theme="' + theme + '"><head><meta charset="utf-8"><base href="' + origin + '/"><title>' + name + '</title>'
    + styles + '</head><body>' + html + '</body></html>');
  doc.close();
  // stylesheets, then fonts, then images
  await Promise.all([...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => (l.sheet ? Promise.resolve() : settle(new Promise((ok) => { l.onload = ok; l.onerror = ok; }), 4000))));
  await settle(doc.fonts?.ready ?? Promise.resolve(), 4000);
  await Promise.all([...doc.images].map((img) => settle(img.decode(), 4000)));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (frame !== f) return; // a newer print replaced this frame while waiting
  const w = f.contentWindow!;
  w.focus();
  w.print();
}

export function PrintJob({ title, onDone, children }: { title?: string; onDone: () => void; children: ReactNode }) {
  // detached host: only its rendered HTML is read
  const [host] = useState(() => document.createElement('div'));
  const started = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const html = host.innerHTML;
    void printHtml(html, title).catch(() => undefined).finally(() => done.current());
  }, [host, title]);
  return createPortal(children, host);
}
