import { useRef } from 'react';
import { buildXlsxBytes, reportNumber, type XlsxCell, type XlsxOutSheet } from '@buddy/core';
import { useSession } from '../session';
import { toast } from '../ui';

/** ดาวน์โหลดแฟ้ม .xlsx (สร้างในเครื่อง ไม่ส่งข้อมูลออก) */
export function downloadXlsx(name: string, sheets: XlsxOutSheet[]) {
  const blob = new Blob([buildXlsxBytes(sheets) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

const cellText = (el: HTMLElement) => {
  if (el.dataset.x !== undefined) return el.dataset.x;
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.no-export, button, select, .no-print').forEach((x) => x.remove());
  // ช่องกรอก (เช่นตารางที่แก้ได้) ใช้ค่าในช่อง
  el.querySelectorAll('input, select').forEach((x) => { const v = (x as HTMLInputElement).value; if (v) c.append(` ${v}`); });
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** ตาราง HTML → แถวของ Excel: รวมเซลล์ (colspan/rowspan) · หัว/ท้ายตารางตัวหนา · เลขชิดขวาเป็นตัวเลข */
export function tableToRows(table: HTMLTableElement): XlsxCell[][] {
  const out: XlsxCell[][] = [];
  const taken = new Map<number, Set<number>>();   // แถว → คอลัมน์ที่ rowspan จากแถวบนจองไว้
  [...table.rows].forEach((tr, ri) => {
    if (tr.classList.contains('no-export') || tr.closest('.no-print')) return;
    const row: XlsxCell[] = [];
    const busy = taken.get(ri) ?? new Set<number>();
    let col = 0;
    const skip = () => { while (busy.has(col)) { row.push(null); col++; } };
    const head = tr.parentElement?.tagName === 'THEAD' || tr.parentElement?.tagName === 'TFOOT';
    for (const td of [...tr.cells]) {
      skip();
      const text = cellText(td);
      const right = td.classList.contains('r') || !!td.querySelector('.num') || getComputedStyle(td).textAlign === 'right';
      const n = right && text ? reportNumber(text) : null;
      const span = Math.max(1, td.colSpan || 1);
      const bold = head || td.tagName === 'TH' || ['sub', 'total', 'opening', 'acc-head', 'rpt-group', 'rpt-sub', 'rpt-total'].some((k) => tr.classList.contains(k));
      row.push({ v: n ?? text, bold, span });   // span = ช่องที่รวม (buildXlsxBytes นับคอลัมน์ให้)
      if ((td.rowSpan || 1) > 1) for (let r = 1; r < td.rowSpan; r++) { const s = taken.get(ri + r) ?? new Set<number>(); for (let k = 0; k < span; k++) s.add(col + k); taken.set(ri + r, s); }
      col += span;
    }
    out.push(row);
  });
  return out;
}

/**
 * ปุ่ม "ส่งออก Excel" ใช้ร่วมทุกรายงาน (เจ้าของ 17/11/2569): ส่งออกตารางรายงานในหน้านี้ (ทุกตาราง ต่อกันในแผ่นงานเดียว)
 * หัวแผ่นงาน = ชื่อบริษัท · ชื่อรายงาน · เงื่อนไข (ข้อความใต้ชื่อรายงาน) · แสดงเฉพาะตารางที่เห็นบนจอ
 */
export function ExcelButton({ name, disabled, selector = 'table' }: { name?: string; disabled?: boolean; selector?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { me } = useSession();
  const run = () => {
    const page = ref.current?.closest('.page') ?? document.querySelector('.page');
    if (!page) return;
    const tables = [...page.querySelectorAll<HTMLTableElement>(selector)].filter((t) => !t.closest('.no-print, .modal') && t.offsetParent !== null && t.rows.length);
    if (!tables.length) { toast('ยังไม่มีข้อมูลรายงาน — กด แสดงรายงาน ก่อน', 'warn'); return; }
    const title = name ?? page.querySelector('h1')?.textContent?.trim() ?? 'รายงาน';
    const lead = page.querySelector('.page-head .lead')?.textContent?.trim();
    const cond = page.querySelector('[data-report-cond]')?.textContent?.replace(/\s+/g, ' ').trim();
    const rows: XlsxCell[][] = [[{ v: me?.company?.name_th ?? '', bold: true }], [{ v: title, bold: true }]];
    if (lead) rows.push([lead]);
    if (cond) rows.push([cond]);
    rows.push([]);
    const freeze = tables.length === 1 ? rows.length + ([...tables[0]!.rows].filter((r) => r.parentElement?.tagName === 'THEAD').length || 1) : undefined;
    tables.forEach((t, i) => { if (i) rows.push([]); const cap = t.caption?.textContent?.trim() ?? t.dataset.title; if (cap) rows.push([{ v: cap, bold: true }]); rows.push(...tableToRows(t)); });
    const ncol = Math.max(...rows.map((r) => r.reduce<number>((s, c) => s + (c && typeof c === 'object' ? c.span ?? 1 : 1), 0)));
    const widths = Array.from({ length: ncol }, (_, i) => {
      const len = Math.max(6, ...rows.slice(5).map((r) => { const c = r[i]; const v = c && typeof c === 'object' ? c.v : c; return typeof v === 'number' ? 14 : String(v ?? '').length; }));
      return Math.min(60, Math.round(len * 1.1) + 2);
    });
    downloadXlsx(title, [{ name: title, rows, widths, freeze }]);
  };
  return <button ref={ref} type="button" disabled={disabled} onClick={run} title="ส่งออกรายงานนี้เป็นแฟ้ม Excel (.xlsx)">📊 ส่งออก Excel</button>;
}
