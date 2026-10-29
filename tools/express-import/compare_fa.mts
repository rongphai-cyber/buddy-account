// เทียบค่าเสื่อมราคาที่ Buddy คำนวณ (packages/core faYearSchedule) กับตารางค่าเสื่อมของ Express (FAMAS.DEPR1–12 ปีปัจจุบัน, DEPR1NY–12NY ปีถัดไป)
// ใช้: apps/server/node_modules/.bin/tsx tools/express-import/compare_fa.mts <โฟลเดอร์ Express> [ไฟล์ผล.json]
// ปีปัจจุบันของ Express อ่านจาก ISPRD.BEG1 · อ่านอย่างเดียว ไม่แตะฐานข้อมูล
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = await import(pathToFileURL(join(here, '../../packages/core/src/index.ts')).href);
const [dir, out] = process.argv.slice(2);
if (!dir) { console.error('ใช้: tsx compare_fa.mts <โฟลเดอร์ Express> [ผล.json]'); process.exit(2); }
const py = `
import sys, json; sys.path.insert(0, ${JSON.stringify(here)})
import express_dbf as e, os
D = ${JSON.stringify(dir)}
rd = lambda t: list(e.records(os.path.join(D, t + '.DBF'), e.header(os.path.join(D, t + '.DBF'))))
prd = rd('ISPRD')[0]
print(json.dumps({'beg1': prd['BEG1'], 'assets': rd('FAMAS')}, ensure_ascii=False))
`;
const raw = JSON.parse(execFileSync('python', ['-c', py], { encoding: 'utf-8', maxBuffer: 64 << 20, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
const iso = (s: string | null) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const year = Number(raw.beg1.slice(0, 4));
const money = (v: number | null) => (Math.round((v || 0) * 100) / 100).toFixed(2);
let ok = 0, n = 0, skip = 0; const bad: Array<Record<string, any>> = [];
for (const r of raw.assets as Array<Record<string, any>>) {
  const a = { method: ['0', '1', '2'].includes(r.METHOD) ? r.METHOD : '1', is_depreciable: r.FASTYP !== 'N', cost: money(r.COSVAL), salvage_value: money(r.SALVAG), rate: String(r.RATE || 0),
    useful_life_years: r.LIFE || null, start_date: iso(r.STRDAT) ?? iso(r.PURDAT), end_date: iso(r.ENDDAT), sold_date: iso(r.SALDAT), depr_monthly: r.DPRMONLY !== 'N', manual_depr: money(r.DPRAMT), manual_depr_to: iso(r.LASCAL) };
  const ex1 = Array.from({ length: 12 }, (_, i) => money(r[`DEPR${i + 1}`])), ex2 = Array.from({ length: 12 }, (_, i) => money(r[`DEPR${i + 1}NY`]));
  if (!a.is_depreciable && ex1.every((v: string) => v === '0.00') && ex2.every((v: string) => v === '0.00')) { skip++; continue; }
  n++;
  const y1 = core.faYearSchedule(a, year, money(r.ACCMBF));
  const acc2 = core.d(money(r.ACCMBF)).plus(ex1.reduce((s: any, v: string) => s.plus(v), core.d(0)));   // ปีถัดไปต่อจากยอดปีปัจจุบันของ Express
  const y2 = core.faYearSchedule(a, year + 1, acc2.toFixed(2));
  const same = y1.join() === ex1.join() && y2.join() === ex2.join();
  if (same) ok++; else bad.push({ code: r.FASCOD, method: a.method, start: a.start_date, cost: a.cost, rate: a.rate, accum_bf: money(r.ACCMBF), express: [ex1, ex2], buddy: [y1, y2] });
}
console.log(`ค่าเสื่อมปี ${year}–${year + 1}: ตรง ${ok}/${n} รายการ (ไม่คิดค่าเสื่อม ${skip})`);
for (const b of bad.slice(0, 20)) console.log('✗', b.code, `วิธี ${b.method} เริ่ม ${b.start} ทุน ${b.cost} อัตรา ${b.rate}% ยกมา ${b.accum_bf}`, '| Express ปีนี้', b.express[0].reduce((s: number, v: string) => s + Number(v), 0).toFixed(2), 'Buddy', b.buddy[0].reduce((s: number, v: string) => s + Number(v), 0).toFixed(2));
if (out) writeFileSync(out, JSON.stringify({ year, matched: ok, checked: n, skipped: skip, mismatch: bad }, null, 1));
process.exit(bad.length ? 1 : 0);
