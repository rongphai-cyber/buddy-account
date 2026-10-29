# บันทึกส่งต่องาน (HANDOFF) — Buddy Account

> **Claude: อ่านไฟล์นี้ก่อนเริ่มทุกครั้ง** (หลังสรุป context อัตโนมัติ หรือเปิด session ใหม่) แล้วทำต่อจาก "งานถัดไป"
> อัปเดตไฟล์นี้ทุกครั้งที่จบงาน (ก่อน commit) และทันทีเมื่อ context ใกล้เต็ม — เขียนให้คนที่ไม่เคยเห็นบทสนทนาทำต่อได้

อัปเดตล่าสุด: 29/10/2569 · commit ล่าสุดบน GitHub: ดู `git log -1` (main = origin/main)

## สถานะ
- ตั้งค่าครั้งแรกครบ: git + GitHub (`rongphai-cyber/buddy-account`, private), PostgreSQL ของ Buddy, ข้อมูล TESTRice → DEMO, smoke test
- เฟส P1 ที่ทำได้ตอนนี้เสร็จทั้งหมด (T1.10–T1.14, T1.16) — ค้าง T1.15 (รอ P3 แฟ้มภาษี) และ T1.17 (ทำพร้อม P2)
- P0: T0.14 Row-Level Security เสร็จ (ดู `docs/05_หลายลูกค้าและความปลอดภัย.md` ข้อ 10 — **ตารางใหม่ที่มี company_id ต้องเปิด RLS ใน migration**, โค้ดใช้ `database.db` ไม่ใช่ `database.raw`)
- P0: T0.10 สิทธิ์ 7 ชนิดรายเมนูเสร็จ (`apps/server/src/modules/permissions.ts` — API ใหม่ต้องเพิ่มกฎใน `API_RULES` ไม่งั้นถูกปฏิเสธ และทดสอบ "every API route has a permission rule" ล้ม)
- ความครอบคลุมหน้าจอ: เสร็จ 48 / 248 (กำลังทำ 4) (ดู `docs/04_ความครอบคลุมหน้าจอ.md`)

## กำลังทำ (29/10/2569 — เจ้าของสั่ง "Start P2" ทำต่อจนเสร็จ)
**T2.1 เสร็จแล้ว** — แคตตาล็อก `packages/core/src/settings.ts` (เพิ่มค่าใหม่ที่นี่ แล้ว `pnpm settings:catalog` สร้าง JSON ให้ importer; ชุดทดสอบ core ตรวจว่าตรงกัน), API `/api/v1/settings`, หน้าจอ `/settings/defaults`; DEMO นำเข้าใหม่แล้ว (ค่าจาก ISINFO 63 ค่า)
**T2.2 เสร็จแล้ว** — คู่มือบทที่ 7 S-AR-01 / S-AP-01 (wip: เหลือแท็บยอดรายงวด/เช็ค ทำใน P3/P4) / S-SO-01 (done)
- migration 0008: md_party_contact (ผู้ติดต่อหลายคน C/S), md_supplier_bank, ช่องใหม่ของลูกค้า/พนักงานขาย, **view ทุกตัวเป็น security_invoker** (ไม่งั้น view ข้าม RLS — ทดสอบ RLS ตรวจไว้แล้ว; view ใหม่ต้อง `WITH (security_invoker = true)`)
- API `apps/server/src/modules/parties.ts`: `/api/v1/customers|suppliers|salespersons` (+ `/:id`), `/api/v1/lookups?types=40,41,45,46,47,55,BANK`
- เลขผู้เสียภาษี: ค่าใหม่ `gen.allow_blank_party_tax_id` (ค่าเริ่มต้นแต่ละระบบ › เรื่องทั่วไป, ไม่ติ๊ก = บังคับ) — บังคับเฉพาะรายใหม่ และรายที่เคยมีเลขแล้ว (รายเก่าจาก Express ที่ไม่มีเลขยังแก้ได้)
- ยอดคงค้างลูกค้า = IV + DR − CN − รับชำระ (v_ar_outstanding) → DEMO รวม 26,566,359.42 = IV 29,898,801.25 (ตรง Express) − CN ค้าง 3,332,441.83; ผู้จำหน่าย 19,652,932.52 (+ −7,454.69 ไม่มีรหัสผู้จำหน่าย)
- หน้าจอ `apps/web/src/pages/parties/Parties.tsx` (/ar/customers /ap/suppliers /ar/salespersons) — CSS ฟอร์มใช้ `.form-grid.party-grid` (buddy.css โหลดทีหลังและทับ `.form-grid`)
- TESTRice ไม่มีเป้าการขาย (OESLM.TAR* เป็นศูนย์ทั้งหมด) → md_sales_target 0 แถวถูกต้อง
- ต่อไป: T2.3 สินค้า (+ S-SET-04 กลุ่มบัญชีสินค้า) → T2.4 บัญชีเงินฝาก + วิธีรับ/จ่ายชำระ (S-SET-06/08) → T2.5 เลขที่เอกสาร + การเชื่อมต่อบัญชี → T1.17 ตารางข้อมูล

## งานถัดไป (รอเจ้าของเลือก — ถ้าเจ้าของบอก "ทำต่อจนเสร็จ" ให้ทำตามลำดับนี้)
1. P0 ที่เหลือ (รอเจ้าของเลือก): T0.15 สำรอง/กู้คืนรายลูกค้า · T0.16 TOTP/ล็อกหลังผิดรหัส · T0.12 นำเข้า Express ผ่านหน้าจอ
2. หรือ P2: **T2.1** ค่าเริ่มต้นทุกระบบ → T2.2 … T2.5 (แล้วทำ T1.17 ตารางข้อมูลพร้อมกัน)
- คำถามค้าง: เจ้าของวางไฟล์ `docs/50ทวิ.pdf` และ `docs/ChartOfAccount_with_English.xlsx` ไว้ (ยังไม่ commit) — ยังไม่ได้บอกว่าใช้ทำอะไร
- ข้อสันนิษฐานที่รอยืนยัน: ฐานของคอลัมน์ "% ของยอดขาย" (PCENTn) = บรรทัดแรกที่มียอด

## วิธีทำงานกับเจ้าของ (ดู memory ด้วย)
- เจ้าของไม่เขียนโค้ด: ทำส่วนเทคนิคเองทั้งหมด ตอบภาษาไทย ขั้นตอนแบบคลิกตาม คำสั่งที่ให้เจ้าของรันเป็น PowerShell
- ได้รับอนุญาตให้ทำงานต่อเนื่อง: จบแต่ละงาน → ทดสอบครบ → commit + push → ทำงานถัดไป
- ท้ายคำตอบให้ข้อความแนะนำที่คัดลอกส่งต่อได้ ("พิมพ์ต่อได้เลย:")

## เปิดใช้/ทดสอบ (เครื่องนี้)
- ฐานข้อมูล: `node tools/local-pg/pg.mjs start|stop|status` — PostgreSQL 16 ของ Buddy พอร์ต 5544 โฟลเดอร์ `.data/pg` (แยกจาก WTS-ERP ห้ามแตะ E:\WTS-ERP)
- รันคำสั่งพร้อม DATABASE_URL: `node tools/local-pg/pg.mjs run -- <คำสั่ง>` (ห้ามพิมพ์ URL/รหัสผ่านลงแชท)
- เปิดโปรแกรม: `node tools/local-pg/pg.mjs run -- pnpm --filter @buddy/server start` (พอร์ต 4100) — server ไม่ reload เอง แก้โค้ด server แล้วต้องปิด-เปิดใหม่
- เจ้าของเปิดเองด้วย `เปิด Buddy Account.cmd` (ต้องปล่อยพอร์ต 4100 ว่าง — ปิด server ของ Claude ก่อนจบงาน)
- รหัสผ่าน admin อยู่ใน `.data/ข้อมูลเข้าระบบ-ผู้ดูแล.txt` (อ่านด้วยสคริปต์ ห้ามแสดง)
- ชุดทดสอบก่อนส่งงาน (CLAUDE.md ข้อ 14–15):
  - `pnpm test` (core 9 + API 20 + schema) · `pnpm typecheck` · `pnpm --filter @buddy/web build`
  - smoke: `PASS=<จากไฟล์> BASE=http://localhost:4100 OUT=<scratchpad>/shots node apps/web/e2e/smoke.cjs` (20 ขั้น)
  - ยอดเงิน: งบทดลอง DEMO ปี 2569 คงเหลือต้องเป็น **245,718,317.16** ทั้งสองด้าน (ปี 2568 คงเหลือ 181,398,941.31)
- ทดลองหน้าจอที่ "บันทึก" ข้อมูล: ใช้ server ทดสอบแยก (PGlite, `BUDDY_DATA_DIR=<scratchpad>/buddy-test PORT=4101`, admin/buddy1234) อย่าเขียนข้อมูลลง DEMO
- นำข้อมูลใหม่ทั้งหมด (ถ้าจำเป็น): drop DB buddy → `node tools/local-pg/pg.mjs run -- bash tools/express-import/import.sh D:/ACC-Program/TESTRice - TESTRice` → ตรวจงบทดลอง 2553 = 245,718,317.16 → `... run -- python tools/demo-data/make_demo.py - TESTRice DEMO` → `... run -- pnpm --silent --filter @buddy/server cli create-admin admin "ผู้ดูแลระบบ" <รหัสจากไฟล์>`

## รูปแบบงานที่ใช้ (ทำซ้ำได้)
- API ใหม่: ไฟล์ใน `apps/server/src/modules/gl/*.ts` + ลงทะเบียนใน `app.ts` · ทุก query กรอง `company_id` · log ใน `sys_activity_log` พร้อมค่าก่อนแก้ · ลบ = ตั้ง `deleted_at`
- ทดสอบใน `apps/server/test/api.test.ts`: ใส่ `it(...)` ก่อน `'keeps companies separate'` + เพิ่มการตรวจข้ามบริษัท (ในข้อ keeps companies separate) และข้ามลูกค้า (ในข้อ separates customer tenants) · ใบสำคัญที่สร้างในทดสอบให้ยกเลิกท้ายข้อ เพื่อไม่ให้ยอดของข้ออื่นเปลี่ยน
- หน้าจอใหม่: `apps/web/src/pages/...` + route ใน `App.tsx` + `packages/core/src/menu.ts` + `docs/coverage_status.json` → `python docs/tools/gen_coverage.py` + ติ๊ก `TASKS.md` + เพิ่มขั้นใน smoke
- แก้ spec: `db/spec/spec.py` → `python db/spec/gen.py` (เขียน LF แล้ว) → migration ใหม่ `db/migrations/NNNN_*.sql` (คัดจาก `db/generated/schema.sql`)

## กับดักที่เจอแล้ว
- Bash heredoc ที่มีข้อความไทยยาว ๆ/อักขระพิเศษ บางครั้งพัง → เขียนสคริปต์ Python ลง scratchpad ด้วย Write แล้วค่อยรัน
- `sed -i` กับข้อความที่มี backtick/`$` พังง่าย → ใช้ Python หรือ Edit
- ไฟล์ `.cmd` ห้ามมีภาษาไทยในบรรทัด REM (cmd อ่านผิด) — ใช้ ASCII
- `python3` บนเครื่องนี้เป็นตัวหลอกของ Store → ใช้ `python`
- Playwright: พิมพ์เลขบัญชีเร็วกว่ารายการบัญชีโหลด จะเปิดหน้าต่างค้นหาแทน → กด Enter อีกครั้ง
- `useHotkeys` เป็นชั้น (layer) — Modal กั้นไม่ให้ปุ่มลัดทะลุไปหน้าหลัง (แก้แล้วใน T1.10)
- ตารางใน Modal ต้องไม่หด (`.modal-body > .table-wrap { flex-shrink: 0 }`)
- สถานะ background task "failed exit 127" หลังสั่งปิด server = ปกติ (เราปิดเอง)
- ทดสอบ API ที่ใช้ผู้ใช้อื่น: บริษัททดสอบอยู่ในลูกค้า DEFAULT — สร้างผู้ใช้/กลุ่มด้วย tenant_id ของ DEFAULT หรือไม่ส่งเลย (ระบบใช้ลูกค้าเจ้าของบริษัทให้เอง)
- Playwright: แท็บเป็น role="tab" ไม่ใช่ button
- สคริปต์ Python ที่เรียก API ให้ใช้ `http://127.0.0.1:4100` ไม่ใช่ `localhost` (Windows ลอง IPv6 ก่อน ช้าขึ้นคำขอละ 2 วินาที)
