// ตรวจว่าข้อมูลที่ย้ายมาจาก Express ไม่ถูกแก้ (หลังแก้โปรแกรม) — แยกจากเอกสารที่คีย์เพิ่มทีหลัง (เช่น เจ้าของคีย์ทดสอบบน DEMO)
// ใช้: node tools/local-pg/pg.mjs run -- node tools/demo-check/tb_check.mjs DEMO
//  - ข้อมูลที่ย้ายมา = แถวที่ไม่มีผู้สร้าง (created_by ว่าง — importer ไม่ใส่ผู้ใช้) · เทียบตัวเลขกับค่าที่จดไว้ใน HANDOFF
//  - เอกสารที่คีย์เพิ่ม = มีผู้สร้าง — แสดงรายการพร้อมสถานะ (ยกเลิกแล้วไม่กระทบยอด)
import { createRequire } from 'node:module';
const pg = createRequire(new URL('../../apps/server/package.json', import.meta.url))('pg');
const code = process.argv[2] ?? 'DEMO';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (s, p = []) => (await c.query(s, p)).rows;
const [co] = await q('SELECT id FROM sys_company WHERE code = $1 AND deleted_at IS NULL', [code]);
if (!co) { console.error(`ไม่พบบริษัท ${code}`); process.exit(1); }
const [imp] = await q(`SELECT count(*)::int AS journals, coalesce(sum(t.dr), 0)::text AS debit, coalesce(sum(t.cr), 0)::text AS credit
  FROM gl_journal j JOIN LATERAL (SELECT sum(debit) dr, sum(credit) cr FROM gl_journal_line l WHERE l.journal_id = j.id AND l.deleted_at IS NULL) t ON true
  WHERE j.company_id = $1 AND j.deleted_at IS NULL AND j.doc_status = 'N' AND j.created_by IS NULL`, [co.id]);
const [docs] = await q(`SELECT count(*)::int AS docs, coalesce(sum(net_amount), 0)::text AS net FROM doc_header
  WHERE company_id = $1 AND deleted_at IS NULL AND doc_status <> 'C' AND created_by IS NULL`, [co.id]);
console.log(`ข้อมูลที่ย้ายมา (${code}): ใบสำคัญ ${imp.journals} ใบ · เดบิต ${imp.debit} · เครดิต ${imp.credit} · เอกสาร ${docs.docs} ใบ ยอดรวม ${docs.net}`);
const added = await q(`SELECT j.voucher_no, j.doc_status, u.username, to_char(j.created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS at,
    (SELECT sum(debit) FROM gl_journal_line l WHERE l.journal_id = j.id AND l.deleted_at IS NULL)::text AS debit
  FROM gl_journal j LEFT JOIN sys_user u ON u.id = j.created_by
  WHERE j.company_id = $1 AND j.deleted_at IS NULL AND j.created_by IS NOT NULL ORDER BY j.created_at`, [co.id]);
const live = added.filter((x) => x.doc_status === 'N');
console.log(`ใบสำคัญที่คีย์เพิ่มทีหลัง: ${added.length} ใบ (ยังไม่ยกเลิก ${live.length} ใบ — กระทบงบทดลอง)`);
for (const x of live) console.log(`  ${x.voucher_no}  ${x.at}  ${x.username ?? '-'}  เดบิต ${x.debit}`);
await c.end();
