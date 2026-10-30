// ลบบริษัททดลองทั้งบริษัท (ข้อมูลทุกตารางที่อ้างบริษัท + แฟ้มบันทึกเหตุการณ์ของบริษัทนั้น) — ใช้กับข้อมูลทดลองเท่านั้น
// สำรองฐานก่อนทุกครั้ง (tools/demo-check/db-backup.mjs save …) · ผู้ใช้/ลูกค้าผู้ใช้บริการไม่ถูกลบ
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/wipe-company.mjs <รหัสบริษัท> --yes
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';

const [code, yes] = process.argv.slice(2);
if (!code || yes !== '--yes') { console.error('ใช้: wipe-company.mjs <รหัสบริษัท> --yes   (สำรองฐานก่อน)'); process.exit(2); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const co = (await c.query(`SELECT id, name_th FROM sys_company WHERE code = $1`, [code])).rows[0];
if (!co) { console.error(`ไม่พบบริษัท ${code}`); process.exit(1); }
// ทุกคอลัมน์ที่อ้าง sys_company(id)
const refs = (await c.query(`SELECT cl.relname AS t, a.attname AS col, a.attnotnull AS nn FROM pg_constraint k
   JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND k.confrelid = 'sys_company'::regclass ORDER BY 1`)).rows;
// ตารางที่มี company_id แต่ไม่มี FK (เผื่อ)
const extra = (await c.query(`SELECT c2.table_name AS t FROM information_schema.columns c2 JOIN information_schema.tables t2 ON t2.table_name = c2.table_name AND t2.table_schema = c2.table_schema
   WHERE c2.table_schema = 'public' AND c2.column_name = 'company_id' AND t2.table_type = 'BASE TABLE'`)).rows.map((r) => r.t);
const del = new Set([...refs.filter((r) => r.col === 'company_id' || r.nn).map((r) => `${r.t}.${r.col}`), ...extra.map((t) => `${t}.company_id`)]);
const nul = refs.filter((r) => r.col !== 'company_id' && !r.nn);
await c.query('BEGIN');
try {
  await c.query(`SET LOCAL session_replication_role = replica`);   // ข้ามการตรวจ FK/trigger ระหว่างลบทั้งบริษัท
  let rows = 0;
  for (const k of del) { const [t, col] = k.split('.'); const r = await c.query(`DELETE FROM "${t}" WHERE "${col}" = $1`, [co.id]); rows += r.rowCount; }
  for (const r of nul) await c.query(`UPDATE "${r.t}" SET "${r.col}" = NULL WHERE "${r.col}" = $1`, [co.id]);
  await c.query(`DELETE FROM sys_company WHERE id = $1`, [co.id]);
  await c.query('COMMIT');
  console.log(`ลบบริษัท ${code} ${co.name_th} แล้ว: ${rows.toLocaleString()} แถว จาก ${del.size} ตาราง · ล้างการอ้างอิง ${nul.length} คอลัมน์`);
} catch (e) { await c.query('ROLLBACK'); console.error('ไม่สำเร็จ (ไม่มีอะไรถูกลบ):', e.message); process.exitCode = 1; }
await c.end();
