import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { blankRowCount, pageLabel, planPages, shrinkToFit } from '@buddy/core';

/**
 * แบ่งหน้าเอกสารพิมพ์ + เลขหน้า (HANDOFF 153 — เจ้าของ: เอกสารยาวหลายหน้า ต้องแสดงเลขที่หน้าเอกสารด้วย)
 *
 * แผ่นเอกสาร (.doc-sheet หนึ่งแผ่นต่อสำเนา) ที่ยาวเกินหนึ่งหน้ากระดาษ แยกเป็นหลายแผ่น แผ่นละหน้า:
 * - ทุกหน้ามีส่วนหัว (ชื่อบริษัท ชื่อเอกสาร เลขที่) ข้อมูลลูกค้า และหัวตาราง · แถวรายการแบ่งตามที่ว่างของหน้า (แถวกับหมายเหตุรายการไม่แยกกัน)
 * - ยอดรวม จำนวนเงินตัวอักษร รายการบัญชี ช่องลงชื่อ ท้ายเอกสาร อยู่หน้าสุดท้าย (ไม่พอ = ยกแถวสุดท้ายไปด้วยหนึ่งแถว)
 * - เลขหน้า "หน้า 1/2" (แบบฟอร์มอังกฤษ "Page 1 of 2") มุมขวาล่างของทุกหน้า · หน้าเดียว = ไม่พิมพ์เลขหน้า · แต่ละสำเนา (ต้นฉบับ/สำเนา) เริ่มหน้า 1 ใหม่
 * - บรรทัดว่างเติมตาราง (บรรทัดขั้นต่ำ) อยู่หน้าสุดท้ายเท่าที่ที่ว่างพอ
 * วัดจากหน้าจอ (ความกว้างแผ่นคงที่ 210 มม. เท่ากระดาษ) — ใช้ทั้งกรอบพิมพ์ (printFrame) และตัวอย่างบนจอ (PagedSheets)
 *
 * HANDOFF 178 (เจ้าของ 23/11/2569): ยอดรวมชิดล่างเหนือช่องลงชื่อ (CSS .ds-sum margin-top:auto) · ที่ว่างระหว่างรายการกับยอดรวม
 * เติมบรรทัดว่างตามแบบฟอร์ม (data-blank = lines/zebra · none = ว่าง) · ตัวเลขไม่ตัดบรรทัด (ย่ออักษรให้พอดีช่อง)
 * · หน้าที่พอดีกระดาษติด .ds-fit (พิมพ์สูงเท่ากระดาษพอดี = หนึ่งแผ่น ไม่ล้นไปแผ่นที่ 2) — คำนวณหน้า/บรรทัดว่างใน core print-paging
 */
const MM = 96 / 25.4;
/** ที่ว่างล่างหน้าสำหรับเลขหน้า (นอกเหนือจากขอบล่างของแผ่น) */
const RESERVE_MM = 6;
const pageMm = (s: Element) => (s.classList.contains('b-half') ? 148 : s.classList.contains('b-cont') ? 279.4 : 297);

type Group = { rows: HTMLTableRowElement[]; h: number; fill: boolean };

/** ตัวเลข (ราคา จำนวนเงิน ยอดรวม) ไม่ตัดบรรทัด: กว้างเกินช่อง = ย่ออักษรลงจนพอดี (ไม่ต่ำกว่า 70%) */
function fitNumbers(sheet: HTMLElement): void {
  for (const td of sheet.querySelectorAll<HTMLElement>('table.ds-lines td.r, table.ds-totals td.r')) {
    td.style.fontSize = '';
    const k = shrinkToFit(td.scrollWidth, td.clientWidth);
    if (k < 1) td.style.fontSize = `${k}em`;
  }
}

/** เติมบรรทัดว่างในที่ว่างระหว่างตารางรายการกับยอดรวม (หน้าเดียว/หน้าสุดท้าย) ตามแบบฟอร์ม */
function fillBlank(sheet: HTMLElement): void {
  const mode = sheet.dataset.blank;
  const win = sheet.ownerDocument.defaultView;
  const table = sheet.querySelector<HTMLTableElement>(':scope > table.ds-lines');
  const tb = table?.tBodies[0];
  const sum = sheet.querySelector<HTMLElement>(':scope > .ds-sum');
  if (!win || (mode !== 'lines' && mode !== 'zebra') || !table || !tb || !sum || table.nextElementSibling !== sum) return;
  const ncol = table.querySelectorAll(':scope > colgroup > col').length || table.tHead?.rows[0]?.cells.length || 1;
  const make = () => {
    const tr = sheet.ownerDocument.createElement('tr');
    tr.className = 'ds-fill ds-blank';
    for (let i = 0; i < ncol; i++) { const td = sheet.ownerDocument.createElement('td'); td.innerHTML = '&nbsp;'; tr.appendChild(td); }
    return tr;
  };
  const gap = parseFloat(win.getComputedStyle(sheet).rowGap) || 0;
  const free = sum.getBoundingClientRect().top - table.getBoundingClientRect().bottom - gap;
  const first = make();
  tb.appendChild(first);
  const h = first.getBoundingClientRect().height;
  const n = blankRowCount(free, h);
  if (!n) { first.remove(); return; }
  for (let i = 1; i < n; i++) tb.appendChild(make());
  // กันล้นหน้า (ปัดเศษ/เส้นขอบ): แผ่นสูงเกินกระดาษ = เอาบรรทัดว่างออกทีละบรรทัด
  const pageH = pageMm(sheet) * MM;
  const blanks = [...tb.querySelectorAll<HTMLTableRowElement>('tr.ds-blank')];
  while (blanks.length && sheet.getBoundingClientRect().height > pageH + 1) blanks.pop()!.remove();
}

function paginate(sheet: HTMLElement): void {
  const win = sheet.ownerDocument.defaultView;
  if (!win || sheet.dataset.paged) return;
  sheet.dataset.paged = '1';
  fitNumbers(sheet);
  const table = sheet.querySelector<HTMLTableElement>(':scope > table.ds-lines');
  const tb = table?.tBodies[0];
  const kids = [...sheet.children] as HTMLElement[];
  if (!table || !tb || !kids.length) return;
  const top = sheet.getBoundingClientRect().top;
  const padB = parseFloat(win.getComputedStyle(sheet).paddingBottom) || 0;
  const contentBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) - top;
  const pageH = pageMm(sheet) * MM;
  if (contentBottom + padB <= pageH + 1) { sheet.classList.add('ds-fit'); fillBlank(sheet); return; }

  // แถวรายการเป็นกลุ่ม (แถว + แถวหมายเหตุของแถวนั้น) · ความสูงรวมเส้นขอบ = ระยะจากก้นกลุ่มก่อนหน้า
  const groups: Group[] = [];
  let prevBottom = tb.getBoundingClientRect().top;
  for (const r of [...tb.rows]) {
    const g = r.classList.contains('ds-line-note') && groups.length ? groups[groups.length - 1]! : (groups.push({ rows: [], h: 0, fill: r.classList.contains('ds-fill') }), groups[groups.length - 1]!);
    g.rows.push(r);
    const b = r.getBoundingClientRect().bottom;
    g.h += b - prevBottom;
    prevBottom = b;
  }
  const headPart = tb.getBoundingClientRect().top - top;
  const tailNeed = contentBottom - (tb.getBoundingClientRect().bottom - top);
  const avail = pageH - padB - RESERVE_MM * MM - headPart;
  if (avail <= 0) return;

  const pages: Group[][] = planPages(groups, avail, tailNeed).map((p) => p.map((i) => groups[i]!));

  const n = pages.length;
  const en = sheet.getAttribute('lang') === 'en';
  [...tb.rows].forEach((r, i) => { r.dataset.pr = String(i); });
  const index = new Map([...tb.rows].map((r, i) => [r, i]));
  const out = pages.map((pg, k) => {
    const keep = new Set(pg.flatMap((g) => g.rows.map((r) => index.get(r)!)));
    const c = sheet.cloneNode(true) as HTMLElement;
    c.classList.add('ds-page', 'ds-fit');
    const ct = c.querySelector<HTMLTableElement>(':scope > table.ds-lines')!;
    for (const r of [...ct.tBodies[0]!.rows]) if (!keep.has(Number(r.dataset.pr))) r.remove();
    if (k < n - 1) {
      ct.tFoot?.remove();
      let x = ct.nextElementSibling;
      while (x) { const nx = x.nextElementSibling; x.remove(); x = nx; }
    }
    if (n > 1) {
      const lab = c.ownerDocument.createElement('div');
      lab.className = 'ds-pageno';
      lab.textContent = pageLabel(k + 1, n, en);
      c.appendChild(lab);
    }
    return c;
  });
  for (const c of out) sheet.before(c);
  sheet.remove();
  fillBlank(out[out.length - 1]!);
}

/** แบ่งหน้าทุกแผ่นเอกสารใน root (แผ่นที่แบ่งแล้วข้าม) */
export function paginateSheets(root: ParentNode): void {
  for (const s of [...root.querySelectorAll<HTMLElement>('.doc-sheet')]) paginate(s);
}

/**
 * ตัวอย่างบนจอแบบแบ่งหน้า: วาด children (แผ่นเอกสาร) ไว้ในที่ซ่อน แล้วคัดลอกมาแบ่งหน้าในกล่องที่แสดง
 * (กล่องที่แสดงไม่มี children ของ React — แก้ DOM ได้) · วาดใหม่เมื่อข้อมูล/แบบอักษรเปลี่ยน
 */
export function PagedSheets({ className, children }: { className?: string; children: ReactNode }) {
  const src = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    if (!src.current || !out.current) return;
    out.current.innerHTML = src.current.innerHTML;
    paginateSheets(out.current);
  });
  useEffect(() => {
    let alive = true;
    const again = () => { if (alive) setTick((t) => t + 1); };
    void document.fonts?.ready.then(again);
    document.fonts?.addEventListener?.('loadingdone', again);
    return () => { alive = false; document.fonts?.removeEventListener?.('loadingdone', again); };
  }, []);
  return <><div ref={out} className={className} /><div ref={src} hidden>{children}</div></>;
}
