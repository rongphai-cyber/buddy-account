// เทียบผลการย้ายข้อมูลสองฐานข้อมูล (ตัวนำเข้า Python vs TypeScript) ทีละตาราง — T0.12
// ใช้: DATABASE_URL=<ฐาน A> DATABASE_URL_2=<ฐาน B> node tools/express-import/parity.mjs [รหัสบริษัท=TESTRice]
//   (ไม่พิมพ์ URL/รหัสผ่าน) · ตารางที่มี company_id เทียบเฉพาะแถวของบริษัทนั้น · ตารางอื่นเทียบทั้งตาราง
//   ทุกคอลัมน์ ยกเว้น created_at/updated_at และคอลัมน์ที่ต่างได้โดยชอบ (ดู SKIP) · จับคู่แถวด้วย id (uuid5 ต้องเท่ากัน)
import { createRequire } from 'node:module';
const pg = createRequire(new URL('../../apps/server/package.json', import.meta.url))('pg');
const code = process.argv[2] ?? 'TESTRice';
const A = process.env.DATABASE_URL, B = process.env.DATABASE_URL_2;
if (!A || !B) { console.error('ต้องตั้ง DATABASE_URL และ DATABASE_URL_2'); process.exit(2); }
const IGNORE_COLS = new Set(['created_at', 'updated_at', 'applied_at']);
/** คอลัมน์ที่ต่างได้โดยชอบ: id ของ sys_tenant สุ่ม (gen_random_uuid) → sys_company.tenant_id เทียบด้วยรหัส tenant แทน */
const SKIP = { sys_tenant: ['id'], sys_company: ['tenant_id'],
  // แถวจากกฎการลงบัญชี (cli company-template ซึ่งไม่ใช่ตัวนำเข้า) — id สุ่ม และ trigger บันทึก sync_change_log ด้วยเลขลำดับ/เวลา/id สุ่ม
  gl_posting_rule: ['id'], sync_change_log: ['seq', 'row_id', 'changed_at'] };
const SKIP_TABLES = new Set(['sys_schema_migration']);
/** ตารางกลาง (ไม่มี company_id) ที่ migration ใส่ข้อมูลตั้งต้นด้วย gen_random_uuid() — id สุ่มต่างกันทุกฐานข้อมูล จึงเทียบด้วยเนื้อหา
 *  (ตัวนำเข้าเขียน md_lookup_type แบบ ON CONFLICT DO NOTHING ซึ่งชนรหัสที่มีอยู่แล้ว → แถวเดิมของ migration) */
const isGlobal = (t, cols) => !cols.includes('company_id') && t !== 'sys_company' && t !== 'sys_tenant';

const ca = new pg.Client({ connectionString: A }), cb = new pg.Client({ connectionString: B });
await ca.connect(); await cb.connect();
const q = async (c, s, p = []) => (await c.query(s, p)).rows;
const coA = (await q(ca, 'SELECT id, tenant_id FROM sys_company WHERE code = $1 AND deleted_at IS NULL', [code]))[0];
const coB = (await q(cb, 'SELECT id, tenant_id FROM sys_company WHERE code = $1 AND deleted_at IS NULL', [code]))[0];
if (!coA || !coB) { console.error(`ไม่พบบริษัท ${code} ใน ${coA ? 'B' : 'A'}`); process.exit(2); }
const tables = await q(ca, `SELECT c.table_name t, array_agg(c.column_name::text ORDER BY c.ordinal_position) cols
  FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
  WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' GROUP BY 1 ORDER BY 1`);

async function snapshot(c, t, cols, co) {
  const where = t === 'sys_company' ? 'WHERE id = $1' : cols.includes('company_id') ? 'WHERE company_id = $1' : t === 'sys_tenant' ? 'WHERE id = $1' : '';
  const params = t === 'sys_tenant' ? [co.tenant_id] : where ? [co.id] : [];
  const skip = isGlobal(t, cols) ? ['id'] : SKIP[t] ?? [];
  const use = cols.filter((x) => !IGNORE_COLS.has(x) && !skip.includes(x)).map((x) => (x === 'company_id' ? `'*'` : `"${x}"`));
  const key = cols.includes('id') && !skip.includes('id') ? 'id::text' : `md5(ROW(${use.join(',')})::text)`;
  const rows = await q(c, `SELECT ${key} k, md5(ROW(${use.join(',')})::text) h FROM ${t} ${where}`, params);
  // คีย์จากเนื้อหา: แถวซ้ำกันได้ → ใส่ลำดับที่ซ้ำ (เทียบแบบ multiset)
  const seen = new Map();
  return new Map(rows.map((r) => { const n = (seen.get(r.k) ?? 0) + 1; seen.set(r.k, n); return [n > 1 ? `${r.k}#${n}` : r.k, r.h]; }));
}
async function rowDiff(t, cols, id) {
  const sel = cols.filter((x) => !IGNORE_COLS.has(x) && !(SKIP[t] ?? []).includes(x) && x !== 'company_id');
  const ra = (await q(ca, `SELECT ${sel.map((x) => `"${x}"::text`).join(',')} FROM ${t} WHERE id::text = $1`, [id]))[0];
  const rb = (await q(cb, `SELECT ${sel.map((x) => `"${x}"::text`).join(',')} FROM ${t} WHERE id::text = $1`, [id]))[0];
  return sel.filter((x) => ra?.[x] !== rb?.[x]).map((x) => `${x}: ${JSON.stringify(ra?.[x])} ≠ ${JSON.stringify(rb?.[x])}`).join(' · ');
}

let fail = 0, pass = 0, empty = 0;
const lines = [];
for (const { t, cols } of tables) {
  if (SKIP_TABLES.has(t)) continue;
  const [a, b] = [await snapshot(ca, t, cols, coA), await snapshot(cb, t, cols, coB)];
  if (!a.size && !b.size) { empty++; continue; }
  const onlyA = [...a.keys()].filter((k) => !b.has(k)), onlyB = [...b.keys()].filter((k) => !a.has(k));
  const diff = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  // hash ของทั้งตาราง (เรียงตามคีย์) — ตรงกัน = ทุกแถวทุกคอลัมน์เท่ากัน
  const ok = !onlyA.length && !onlyB.length && !diff.length;
  ok ? pass++ : fail++;
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(28)} ${String(a.size).padStart(7)} ${String(b.size).padStart(7)}${ok ? '' : `   เฉพาะA ${onlyA.length} เฉพาะB ${onlyB.length} ค่าต่าง ${diff.length}`}`);
  if (!ok && cols.includes('id')) for (const k of diff.slice(0, 3)) lines.push(`      ${k}  ${await rowDiff(t, cols, k)}`);
}
// sys_company.tenant_id: เทียบรหัสลูกค้า (tenant) แทน id ที่สุ่ม
const tc = async (c, co) => (await q(c, 'SELECT code FROM sys_tenant WHERE id = $1', [co.tenant_id]))[0]?.code;
const [ta, tb] = [await tc(ca, coA), await tc(cb, coB)];
lines.push(`${ta === tb ? 'PASS' : 'FAIL'}  sys_company.tenant → รหัส ${ta} / ${tb}`); ta === tb ? pass++ : fail++;
console.log('ผล     ตาราง                           A(แถว)  B(แถว)');
console.log(lines.join('\n'));
console.log(`\nรวม PASS ${pass} · FAIL ${fail} · ตารางว่างทั้งสองฝั่ง ${empty}`);
await ca.end(); await cb.end();
process.exit(fail ? 1 : 0);
