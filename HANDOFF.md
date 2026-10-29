# บันทึกส่งต่องาน (HANDOFF) — Buddy Account

> **Claude: อ่านไฟล์นี้ก่อนเริ่มทุกครั้ง** (หลังสรุป context อัตโนมัติ หรือเปิด session ใหม่) แล้วทำต่อจาก "งานถัดไป"
> อัปเดตไฟล์นี้ทุกครั้งที่จบงาน (ก่อน commit) และทันทีเมื่อ context ใกล้เต็ม — เขียนให้คนที่ไม่เคยเห็นบทสนทนาทำต่อได้

อัปเดตล่าสุด: 29/10/2569 · commit ล่าสุดบน GitHub: ดู `git log -1` (main = origin/main)

## สถานะ
- ตั้งค่าครั้งแรกครบ: git + GitHub (`rongphai-cyber/buddy-account`, private), PostgreSQL ของ Buddy, ข้อมูล TESTRice → DEMO, smoke test
- เฟส P1 ที่ทำได้ตอนนี้เสร็จทั้งหมด (T1.10–T1.14, T1.16) — ค้าง T1.15 (รอ P3 แฟ้มภาษี) และ T1.17 (ทำพร้อม P2)
- P0: T0.14 Row-Level Security เสร็จ (ดู `docs/05_หลายลูกค้าและความปลอดภัย.md` ข้อ 10 — **ตารางใหม่ที่มี company_id ต้องเปิด RLS ใน migration**, โค้ดใช้ `database.db` ไม่ใช่ `database.raw`)
- P0: T0.10 สิทธิ์ 7 ชนิดรายเมนูเสร็จ (`apps/server/src/modules/permissions.ts` — API ใหม่ต้องเพิ่มกฎใน `API_RULES` ไม่งั้นถูกปฏิเสธ และทดสอบ "every API route has a permission rule" ล้ม)
- ความครอบคลุมหน้าจอ: ดู `docs/04_ความครอบคลุมหน้าจอ.md` (ดู `docs/04_ความครอบคลุมหน้าจอ.md`)

## กำลังทำ (29/10/2569 — เจ้าของสั่ง "Start P2" ทำต่อจนเสร็จ)
**T2.1 เสร็จแล้ว** — แคตตาล็อก `packages/core/src/settings.ts` (เพิ่มค่าใหม่ที่นี่ แล้ว `pnpm settings:catalog` สร้าง JSON ให้ importer; ชุดทดสอบ core ตรวจว่าตรงกัน), API `/api/v1/settings`, หน้าจอ `/settings/defaults`; DEMO นำเข้าใหม่แล้ว (ค่าจาก ISINFO 63 ค่า)
**T2.2 เสร็จแล้ว** — คู่มือบทที่ 7 S-AR-01 / S-AP-01 (wip: เหลือแท็บยอดรายงวด/เช็ค ทำใน P3/P4) / S-SO-01 (done)
- migration 0008: md_party_contact (ผู้ติดต่อหลายคน C/S), md_supplier_bank, ช่องใหม่ของลูกค้า/พนักงานขาย, **view ทุกตัวเป็น security_invoker** (ไม่งั้น view ข้าม RLS — ทดสอบ RLS ตรวจไว้แล้ว; view ใหม่ต้อง `WITH (security_invoker = true)`)
- API `apps/server/src/modules/parties.ts`: `/api/v1/customers|suppliers|salespersons` (+ `/:id`), `/api/v1/lookups?types=40,41,45,46,47,55,BANK`
- เลขผู้เสียภาษี: ค่าใหม่ `gen.allow_blank_party_tax_id` (ค่าเริ่มต้นแต่ละระบบ › เรื่องทั่วไป, ไม่ติ๊ก = บังคับ) — บังคับเฉพาะรายใหม่ และรายที่เคยมีเลขแล้ว (รายเก่าจาก Express ที่ไม่มีเลขยังแก้ได้)
- ยอดคงค้างลูกค้า = IV + DR − CN − รับชำระ (v_ar_outstanding) → DEMO รวม 26,566,359.42 = IV 29,898,801.25 (ตรง Express) − CN ค้าง 3,332,441.83; ผู้จำหน่าย 19,652,932.52 (+ −7,454.69 ไม่มีรหัสผู้จำหน่าย)
- หน้าจอ `apps/web/src/pages/parties/Parties.tsx` (/ar/customers /ap/suppliers /ar/salespersons) — CSS ฟอร์มใช้ `.form-grid.party-grid` (buddy.css โหลดทีหลังและทับ `.form-grid`)
- TESTRice ไม่มีเป้าการขาย (OESLM.TAR* เป็นศูนย์ทั้งหมด) → md_sales_target 0 แถวถูกต้อง
**50 ทวิ เสร็จแล้ว (เจ้าของสั่ง 29/10/2569: "ออกแบบฟอร์มตามแบบนี้ทุกประการ" จาก docs/50ทวิ.pdf)** — หน้าจอ `/tax/wht50` (เมนู FI.WHT.CERT)
- ไม่วาดแบบใหม่: ใช้ภาพแบบฟอร์มจริงของกรมสรรพากร `apps/web/public/forms/wht50.png` (300 dpi สร้างจาก PDF ด้วย `node tools/forms/render_wht50.mjs`, pdf.js ไม่วาดช่องกรอก) แล้ววางข้อความตามตำแหน่งช่อง AcroForm ของไฟล์ต้นฉบับ (`packages/core/src/forms/wht50.ts`, หน่วย pt)
- เลข 13 หลักลงช่อง comb 17 ช่อง (1-4-5-2-1), เงินแยกบาท/สตางค์ที่เส้น x 474.9 / 546.4, `bahtText()` ใน core, ฟอนต์ Sarabun, พิมพ์ A4 ไม่มีขอบ (`@page wht50`) ฉบับที่ 1/2
- WTS-ERP ไม่มีแบบเหมือนต้นฉบับ (HTML ย่อ / pdfkit วาดเอง) — ใช้แค่เป็นแนวคิด
- P3: ต่อกับแฟ้มภาษีหัก ณ ที่จ่าย (S-TX-10) ให้พิมพ์จากรายการที่บันทึก + เลขที่อัตโนมัติ (ส่ง `Wht50Data` เข้า `<Wht50Sheet>`)

**T2.3 เสร็จแล้ว** — สินค้า/ชุด/บริการ/รายได้อื่น/ค่าใช้จ่ายอื่น/ตารางราคา/จุดสั่งซื้อ/กลุ่มบัญชีสินค้า (S-SET-04)
- STMAS.STKTYP ที่ถูกต้อง: 0 สินค้า · 1 ชุดธรรมดา · 2 ชุดพิเศษ · 3 บริการ · 4 รายได้อื่น · 5 ค่าใช้จ่ายอื่น (`ITEM_KINDS` ใน `packages/core/src/items.ts` = ชนิด → เมนูสิทธิ์/เส้นทาง API/หน้าจอ)
- API `apps/server/src/modules/items.ts`: /items /kits /services /other-incomes /other-expenses (ตัวจัดการเดียวกัน กฎสิทธิ์ตามชนิด), /items/:id/prices, /items/:id/reorder, /kits/:id/copy, /item-account-groups; lookups UNIT/WH/IAG
- บัญชีของ บริการ/รายได้อื่น/ค่าใช้จ่ายอื่น เก็บใน "กลุ่มบัญชีเฉพาะสินค้า" (`item_specific`, แบบ Express METHOD='-'): ค่าใช้จ่าย=inventory(01) · รายได้=sales(03) · รับคืน=sales_return(04) · บริการ Dr ต้นทุน=cogs(02) / Cr ค่าแรง=inventory(01) · ต้นทุนต่อหน่วย=std_cost
- หน่วยนับ/คลังยังไม่มีหน้าจอเพิ่ม (T1.17 ตารางข้อมูล) — บริษัทใหม่ต้องมีหน่วยนับก่อนเพิ่มสินค้า
- ⚠️ ตัวนำเข้า/posting_engine ยังถือ item_type '2' = บริการ (NONSTOCK_TYPES, PURCHASE) — ไม่แก้ตอนนี้เพราะงบทดลองกระทบยอดกับ Express แล้ว; แก้ตอนเขียนระบบลงบัญชีใน P3
- ช่องว่างในฟอร์มต้องส่งเป็น null (id/วันที่) — ดู save ใน `pages/items/Items.tsx`
**ผังบัญชีตัวอย่างไทย–อังกฤษ (เจ้าของสั่ง 29/10/2569)** — จาก `docs/ChartOfAccount_with_English.xlsx` (ไฟล์ของเจ้าของ ไม่ commit) → `python tools/chart/xlsx_chart.py` สร้าง `db/seed/chart_template_th_en.json` (287 บัญชี บทบาท 34/34)
- สร้างบริษัทใหม่เลือก "ผังบัญชีตัวอย่าง ไทย–อังกฤษ" ได้ (chart: th_en) · หน้าผังบัญชีมีปุ่ม "ผังบัญชีตัวอย่าง": เลือกบัญชีที่ยังไม่มีเพิ่มเข้าผัง (บัญชีคุมเพิ่มให้เอง) + เติมชื่ออังกฤษจากชื่อไทยที่ตรงกัน (ไม่ทับชื่อเดิม)
- API `modules/gl/chart-templates.ts` (GL.ACC read/add) · ผังของบริษัทยังเพิ่ม/แก้/เปลี่ยนเลข/ลบได้ตามปกติ
**T2.4 เสร็จแล้ว** — `modules/banking.ts`: /bank-accounts (FI.BK.ACC) · /payment-methods/:direction R|P (เมนูใหม่ SET.PAYM บันทึกทั้งตาราง สลับรหัสได้ ลบได้เฉพาะที่ยังไม่ใช้ใน doc_payment) · หน้าจอ `pages/finance/Banking.tsx`
- ⚠️ **ตรวจ typecheck ต้องดู exit code**: `pnpm -s typecheck` (silent) ซ่อนข้อผิดพลาด — ใช้ `pnpm typecheck; echo exit=$?` (เจอว่าล้มมาตั้งแต่ T2.2 แก้แล้ว 29/10/2569)
- view (v_ar_outstanding ฯลฯ) ไม่อยู่ในชนิดของ Kysely → ใช้ `sql\`...\`` ตรง (ดู outstandingBills ใน parties.ts)
**T2.5 เสร็จแล้ว** — `modules/doc-types.ts`: /doc-types (SET.DOCNO) · /gl/link (SET.LINK: gen.link_gl + gl_journal_route + gl_default_account) · หน้าจอ `pages/settings/DocTypes.tsx`
- เลขที่เอกสาร = md_doc_type.code + next_no 7 หลัก (migration 0010, นำเข้าจาก ISRUN.DOCNUM) — `formatDocNo`/`checkDocNumbering` ใน core; md_doc_number_block (ช่วงเลขของเครื่องออฟไลน์) ยังไม่ใช้
- บริษัทใหม่ได้ STANDARD_DOC_TYPES 34 ประเภท (`seedDocTypes`) · ความหมายช่องบัญชี DOC_SLOT_ROLES (ซ้ำกับ posting_engine.py SLOT_ROLE — แก้ให้ตรงกันทั้งสองที่)
- คำอธิบายในสมุดรายวัน: importer แปลงนิพจน์ xBase → `{party.title} {party.name}` / `{bank.short_name}` / `{doc.remark}` / `{line.item_name}` · P3 ใช้ `renderJournalDesc()`
- ช่องเลขที่บัญชี (AccountCell) กด Enter ก่อนผังโหลดเสร็จ: จำไว้แล้วค่อยหา (เดิมเปิดหน้าต่างค้นหาผิด ๆ — smoke ล้มเป็นครั้งคราว)
**T1.17 เสร็จแล้ว — เฟส P2 ครบทุกงาน (29/10/2569)** — `modules/data-tables.ts` /data-tables/:code (SET.TBL) · `DATA_TABLES` ใน core/menu.ts · หน้าจอ `pages/settings/DataTables.tsx`
- หน่วยนับ (20) คลัง (21) ธนาคาร (01) อยู่ในตารางของตัวเอง (migration 0011 ย้ายชื่อย่อ/อัตราจาก md_lookup แล้วเลิกใช้สำเนา — importer ไม่ซ้ำแล้ว) · แผนก (50) อยู่หน้าแผนก
- รหัสที่ใช้แล้ว: ตารางของตัวเองหาจาก foreign key ทุกตัว (pg_constraint), md_lookup หาจาก DATA_TABLES.refs — ตารางใหม่ที่อ้างรหัส md_lookup ต้องเพิ่ม refs
**P3 เริ่มแล้ว (เจ้าของสั่ง "เริ่ม P3" 29/10/2569) — แผนงาน T3.1–T3.11 อยู่ใน TASKS.md**
- ✅ T3.1 เครื่องลงบัญชี: `packages/core/src/posting.ts` (`buildPosting` บริสุทธิ์ + unit test) · `apps/server/src/modules/posting.ts` (`loadResolver` 3 ชั้น + `loadPostingInput` + `comparePosting`)
  - ตรวจ: `node tools/local-pg/pg.mjs run -- pnpm --silent --filter @buddy/server cli posting-compare DEMO` → ต้องได้ ≥ 97.0% (ตอนนี้ 14,923/15,382 เท่าต้นแบบ Python ทุกหมวด)
  - วิธีชำระเงินโอนที่ไม่มีบัญชี ใช้บัญชีของบัญชีเงินฝากที่ผูก (เพิ่มจากต้นแบบ — ผลไม่เปลี่ยน)
- ✅ T3.2 แกนเอกสาร `apps/server/src/modules/docs/engine.ts`: `issueDocNo` (FOR UPDATE, ข้ามเลขที่มีแล้ว) · `postDocument(tx, ctx, headerId)` (ใบสำคัญเลขที่ = เลขที่เอกสาร, สมุดจากประเภทเอกสาร→เส้นทาง→00, คำอธิบายจากแม่แบบ, บรรทัดมี posting_role + resolved_from ชั้น 1/2/3/S, gen.link_gl=false ไม่ลง) · `repostDocument` (แก้ใบเดิมเลขเดิม บรรทัดเก่า soft delete) · `cancelDocument` (C + ใบสำคัญ C; มีการตัดชำระแล้วห้ามยกเลิก)
  - API `modules/docs/routes.ts`: GET /docs/:id/journal · GET /docs/:id/posting-preview · POST /docs/:id/repost (SET.LINK)
  - เอกสารแต่ละระบบ (T3.3+) เรียก issueDocNo + insert doc_* + postDocument ในทรานแซกชันเดียว
- ⏳ T3.3/T3.4 เอกสารซื้อขาย: ✅ core `doc-calc.ts` (`computeDoc` ตรง Express: line net ไม่รวม VAT หลังเฉลี่ยส่วนลด, `TRADE_KINDS` 8 ชนิด) ✅ API `modules/docs/trade.ts` (/sales-invoices /cash-sales /ar-debit-notes /ar-credit-notes /purchase-invoices /cash-purchases /ap-debit-notes /ap-credit-notes + /:id/cancel + /trade-defaults/:cls; บันทึก/แก้ = ลงบัญชี; แก้ไม่ได้เมื่อมีการตัดชำระ) + ทดสอบ 32 ข้อ ✅ หน้าจอ `apps/web/src/pages/docs/TradeDocs.tsx` (TradeListPage/TradeFormPage ใช้ทุกชนิด, เส้นทาง TRADE_KINDS[].route, /api/v1/item-search) + smoke + ทดสอบเปิดบิลผ่านหน้าจอบน server ทดสอบ (IV ลงบัญชีถูก)
  - ยังไม่ทำในเอกสาร: ตัดสต๊อก/ต้นทุน (P4), แฟ้มภาษีขาย/ซื้อ (T3.9), หักมัดจำ (T3.6), อ้างใบสั่งขาย/ใบสั่งซื้อ (T3.7), เตือนขายต่ำกว่าทุน/เกินวงเงิน, คลังเริ่มต้น ic.main_warehouse
  - ⚠️ server ทดสอบ 4101: TaskStop ปิดแค่ shell — ต้องฆ่า node ที่ฟังพอร์ต (PowerShell Get-NetTCPConnection -LocalPort 4101) · บริษัทเก่าใน server ทดสอบไม่มีประเภทเอกสาร — สคริปต์สร้างบริษัทใหม่ (scratchpad/trade_ui.cjs)
- ต่อไป: T3.5 รับชำระ/จ่ายชำระ (ตัดบิล วิธีชำระ ภาษีหัก ณ ที่จ่าย → แฟ้ม WHT + พิมพ์ 50 ทวิจากรายการ)

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
