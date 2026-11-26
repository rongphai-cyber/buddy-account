import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ACTION_MENUS, menuForPath, readOnlyExempt } from '@buddy/core';
import type { Me } from './api';
import { useSession } from './session';
import { toast } from './ui';
import { isReadOnlyNow, setReadOnlyNow } from './roflag';

/**
 * โหมดดูอย่างเดียว (HANDOFF 157 · เจ้าของ 20/11/2569 "มีหลายเมนู ไม่ควรจะให้เพิ่ม หรือบันทึก หรือเปลี่ยนแปลงได้ ดูได้อย่างเดียว ขอตรวจเช็คทุกเมนู")
 * หน้าจอของเมนูที่ผู้ใช้ไม่มีสิทธิ์ทั้งเพิ่มและแก้ไข (เช่น ผู้ใช้ดูอย่างเดียวของลูกค้าทดลอง) — ด่านเดียวทั้งโปรแกรม ไม่ต้องแก้ทีละหน้า:
 * - แถบ "ดูอย่างเดียว" บนหน้าจอ
 * - คีย์ในช่องข้อมูล/เลือกในรายการ/ติ๊กช่อง ไม่ได้ (ช่องค้นหาและเงื่อนไขของรายการใช้ได้ตามปกติ)
 * - ปุ่มที่เปลี่ยนข้อมูล (+ เพิ่ม · บันทึก · สร้าง · ลบ · ยกเลิกเอกสาร · นำเข้า …) จางและกดไม่ได้ · ปุ่มลัด F9 Ctrl+S Insert Alt+C Alt+E Delete ไม่ทำงาน
 * - หน้าต่าง "มีการแก้ไขที่ยังไม่บันทึก" ไม่มีปุ่มบันทึก (unsaved.tsx)
 * ด่านจริงอยู่ที่ API (ทุก POST/PUT/DELETE ตอบ 403 — ชุดทดสอบ HANDOFF 157) · หน้านี้ทำให้หน้าจอตรงกับสิทธิ์
 */
export { isReadOnlyNow };

export function readOnlyFor(me: Me | null | undefined, pathname: string): boolean {
  if (!me || me.user.is_admin) return false;
  const code = menuForPath(pathname);
  if (!code || readOnlyExempt(code)) return false;
  const p = me.perms?.[code];
  return !!p && p.add === false && p.edit === false;
}
/** อ่านได้ · เมนูที่มีไว้ "ทำ" อย่างเดียว (สร้างบริษัท นำเข้า ปิดงวด ประมวลผลสิ้นปี สำรอง …) ต้องเพิ่มหรือแก้ไขได้ด้วย — ผู้ใช้ดูอย่างเดียวไม่เห็น (HANDOFF 157) */
export function menuVisible(code: string, perms: Me['perms'] | undefined): boolean {
  const p = perms?.[code];
  if (p?.read === false) return false;
  return !ACTION_MENUS.has(code) || !p || p.add !== false || p.edit !== false;
}
/**
 * สถานะเมนูของผู้ใช้ (HANDOFF 197 · เจ้าของ 26/11/2569 ข้อ 5 "ถ้าไม่ตรวจสอบสิทธิหมายถึงผู้ใช้สามารถเห็นเมนูต่างๆ แต่จะใช้งานได้หรือไม่ได้ขึ้นอยู๋กับสิทธิ")
 * show = เปิดได้ · off = แสดงจาง กดแล้วบอกเหตุผล (ผู้ใช้ที่ไม่ได้ตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์") · hide = ไม่แสดง (ซ่อนเมนู · ระบบที่ปิด · เมนูผู้ให้บริการ)
 */
export function menuState(code: string, me: Pick<Me, 'perms' | 'menu_mode' | 'perm_why'> | null | undefined): { state: 'show' | 'off' | 'hide'; why?: string } {
  if (menuVisible(code, me?.perms)) return { state: 'show' };
  const why = me?.perm_why?.[code];
  if (me?.menu_mode === 'disable' && why) return { state: 'off', why };
  return { state: 'hide' };
}
export function useReadOnly() { const { me } = useSession(); return readOnlyFor(me, useLocation().pathname); }

/** ช่องค้นหา/เงื่อนไขของรายการ แถบบน แถบเมนู หน้าต่างค้นหา — ใช้ได้เสมอ */
const FREE = '.toolbar, .filters, .rpt-filters, .dash-filters, .search-box, [role=search], .topbar, .sidebar, .menu-search, .lookup, [data-ro-ok]';
/** ปุ่มที่เปลี่ยนข้อมูล (ไทย/อังกฤษ — โหมด EN แปลข้อความบนปุ่ม) */
const WRITE_BTN = /^\s*(\+|บันทึก|สร้าง|เพิ่ม|ลบ|ยกเลิกเอกสาร|นำเข้า|นำข้อมูล|นำกลับ|ปิดงวด|เปิดงวด|ล็อค|ปลดล็อค|ประมวลผล|คิดค่าเสื่อม|ลงบัญชี|อนุมัติ|รับรอง|อัปโหลด|เลิกใช้$|ใช้งาน$|แก้ไข\s*(Alt|$)|Save|Create|Add|Delete|Void|Import|Restore|Close Period|Lock|Unlock|Process|Post|Approve|Upload|Inactive$|Active$|Edit\s*(Alt|$))/i;
const MSG = 'ดูอย่างเดียว — บัญชีนี้ไม่มีสิทธิ์เพิ่มหรือแก้ไขในเมนูนี้ (ขอสิทธิ์จากผู้ดูแลระบบ)';
let lastTip = 0;
const tip = (el?: Element | null) => { if (Date.now() - lastTip > 1500) { lastTip = Date.now(); toast(MSG, 'warn', el); } };
const free = (el: Element) => !!el.closest(FREE) || el.matches('input[type=search], input.search');
const field = (el: Element) => el.matches('input:not([type=button]):not([type=submit]):not([type=hidden]), textarea, select, [contenteditable="true"]');
const writeBtn = (el: Element | null) => {
  const b = el?.closest('button, [role=button]');
  return b && !b.closest('.topbar, .sidebar, [data-ro-ok]') && WRITE_BTN.test(b.textContent ?? '') ? b : null;
};
const stop = (e: Event, el?: Element | null) => { e.preventDefault(); e.stopImmediatePropagation(); tip(el); };

// ฟังที่ window ช่วงจับ (capture) ตั้งแต่โหลดโปรแกรม — ก่อนปุ่มลัด/ตัวจัดการของทุกหน้าจอ · ทำงานเฉพาะตอนอยู่หน้าดูอย่างเดียว
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!isReadOnlyNow()) return;
    const t = e.target as Element;
    const k = e.key;
    if (k === 'F9' || ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') || k === 'Insert' || (e.altKey && /^[ce]$/i.test(k))) return stop(e, t);
    if (!(t instanceof Element) || free(t)) return;
    if (k === 'Delete' && !field(t)) return stop(e, t);
    // รายการเลือก: ลูกศร/ช่องว่าง/ตัวอักษรเปลี่ยนค่า — Tab Enter Esc ยังเลื่อนช่องได้
    if (t.matches('select') && !['Tab', 'Enter', 'Escape', 'Shift'].includes(k)) return stop(e, t);
    if (t.matches('input[type=checkbox], input[type=radio]') && k === ' ') return stop(e, t);
  }, true);
  for (const type of ['beforeinput', 'paste', 'cut', 'drop'] as const) {
    window.addEventListener(type, (e) => { const t = e.target as Element; if (isReadOnlyNow() && t instanceof Element && field(t) && !free(t)) stop(e, t); }, true);
  }
  window.addEventListener('mousedown', (e) => { const t = e.target as Element; if (isReadOnlyNow() && t instanceof Element && t.matches('select') && !free(t)) stop(e, t); }, true);
  window.addEventListener('click', (e) => {
    if (!isReadOnlyNow()) return;
    const t = e.target as Element;
    if (!(t instanceof Element)) return;
    if (t.matches('input[type=checkbox], input[type=radio]') && !free(t)) return stop(e, t);
    const b = writeBtn(t);
    if (b) stop(e, b);
  }, true);
}

/** จางปุ่มที่เปลี่ยนข้อมูล (ไม่แตะ disabled ของ React) */
function markButtons(on: boolean) {
  document.querySelectorAll('.ro-off').forEach((b) => { if (!on || !writeBtn(b)) { b.classList.remove('ro-off'); b.removeAttribute('aria-disabled'); } });
  if (!on) return;
  document.querySelectorAll('.main button, .modal button').forEach((b) => { if (writeBtn(b) === b) { b.classList.add('ro-off'); b.setAttribute('aria-disabled', 'true'); b.setAttribute('title', MSG); } });
}

/** วางครั้งเดียวในส่วนเนื้อหา (App) — แถบแจ้ง + เปิด/ปิดด่าน */
export function ReadOnlyGuard() {
  const ro = useReadOnly();
  setReadOnlyNow(ro);
  useEffect(() => {
    setReadOnlyNow(ro);
    document.documentElement.toggleAttribute('data-readonly', ro);
    markButtons(ro);
    if (!ro) return;
    let pending = false;
    const mo = new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; markButtons(isReadOnlyNow()); }); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); };
  }, [ro]);
  useEffect(() => () => { setReadOnlyNow(false); document.documentElement.removeAttribute('data-readonly'); markButtons(false); }, []);
  if (!ro) return null;
  return <div className="ro-banner" role="note">🔒 ดูอย่างเดียว — บัญชีนี้อ่านเมนูนี้ได้อย่างเดียว เพิ่ม แก้ไข หรือบันทึกไม่ได้ (ขอสิทธิ์จากผู้ดูแลระบบ)</div>;
}
