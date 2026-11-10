#!/usr/bin/env node
// รุ่นของโปรแกรม (เจ้าของ 10/11/2569: "ควรมีรุ่นของโปรแกรมไว้ตรวจสอบว่าล่าสุดหรือไม่")
// ไฟล์ version.json ที่ราก repo = รุ่นเดียวของทั้งโปรแกรม (หน้าจอทุกตัว + เซิร์ฟเวอร์ /health) · รูปแบบ พ.ศ.เดือน.วัน-ครั้งที่ เช่น 2569.11.10-2
//
//   node tools/version/stamp.mjs              ตั้งรุ่นใหม่ (วันนี้ตามเวลาไทย · วันเดียวกัน = ครั้งที่ +1)
//   node tools/version/stamp.mjs --show       แสดงรุ่นปัจจุบัน
//   node tools/version/stamp.mjs --check      ตรวจ commit ที่ยังไม่ได้ push: แก้โค้ดแล้วยังไม่ได้ตั้งรุ่นใหม่ = exit 1 (แก้แค่ .md / docs/ ไม่ต้องตั้ง)
//   กติกา: ทุกครั้งที่ push โค้ด (คลาวด์ deploy ใหม่) ต้องตั้งรุ่นใหม่ แล้วแจ้งเจ้าของว่ารุ่นล่าสุดคือเลขอะไร
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const file = `${root}version.json`;
const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };

export function today(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  return `${Number(y) + 543}.${m}.${d}`;
}
export function next(current, day) {
  const m = /^(\d{4}\.\d{2}\.\d{2})-(\d+)$/.exec(current ?? '');
  return `${day}-${m && m[1] === day ? Number(m[2]) + 1 : 1}`;
}
const DOC_ONLY = (f) => /\.md$/i.test(f) || /^docs\//.test(f);

const arg = process.argv[2];
if (arg === '--show') {
  console.log(read().version ?? '(ยังไม่มี version.json)');
} else if (arg === '--check') {
  const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: root, encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['diff', '--name-only', `${upstream}..HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const code = files.filter((f) => !DOC_ONLY(f));
  if (code.length && !files.includes('version.json')) {
    console.error(`✗ มีโค้ดที่ยังไม่ได้ push ${code.length} ไฟล์ (เช่น ${code.slice(0, 3).join(', ')}) แต่ยังไม่ได้ตั้งรุ่นใหม่ — รัน node tools/version/stamp.mjs แล้ว commit version.json`);
    process.exit(1);
  }
  console.log(`✓ รุ่น ${read().version}${code.length ? ' (ตั้งใหม่แล้ว)' : ' (ไม่มีโค้ดใหม่)'}`);
} else if (arg === undefined) {
  const cur = read();
  const v = next(cur.version, today());
  writeFileSync(file, `${JSON.stringify({ version: v, about: 'รุ่นของโปรแกรม — ตั้งด้วย node tools/version/stamp.mjs (พ.ศ.เดือน.วัน-ครั้งที่)' }, null, 2)}\n`);
  console.log(`รุ่นใหม่: ${v}${cur.version ? ` (เดิม ${cur.version})` : ''}`);
} else {
  console.error('ใช้: node tools/version/stamp.mjs [--show | --check]');
  process.exit(2);
}
