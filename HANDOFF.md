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
- ✅ T3.3/T3.4 เอกสารซื้อขาย: ✅ core `doc-calc.ts` (`computeDoc` ตรง Express: line net ไม่รวม VAT หลังเฉลี่ยส่วนลด, `TRADE_KINDS` 8 ชนิด) ✅ API `modules/docs/trade.ts` (/sales-invoices /cash-sales /ar-debit-notes /ar-credit-notes /purchase-invoices /cash-purchases /ap-debit-notes /ap-credit-notes + /:id/cancel + /trade-defaults/:cls; บันทึก/แก้ = ลงบัญชี; แก้ไม่ได้เมื่อมีการตัดชำระ) + ทดสอบ 32 ข้อ ✅ หน้าจอ `apps/web/src/pages/docs/TradeDocs.tsx` (TradeListPage/TradeFormPage ใช้ทุกชนิด, เส้นทาง TRADE_KINDS[].route, /api/v1/item-search) + smoke + ทดสอบเปิดบิลผ่านหน้าจอบน server ทดสอบ (IV ลงบัญชีถูก)
  - ยังไม่ทำในเอกสาร: ตัดสต๊อก/ต้นทุน (P4), แฟ้มภาษีขาย/ซื้อ (T3.9), หักมัดจำ (T3.6), อ้างใบสั่งขาย/ใบสั่งซื้อ (T3.7), เตือนขายต่ำกว่าทุน/เกินวงเงิน, คลังเริ่มต้น ic.main_warehouse
  - ⚠️ server ทดสอบ 4101: TaskStop ปิดแค่ shell — ต้องฆ่า node ที่ฟังพอร์ต (PowerShell Get-NetTCPConnection -LocalPort 4101) · บริษัทเก่าใน server ทดสอบไม่มีประเภทเอกสาร — สคริปต์สร้างบริษัทใหม่ (scratchpad/trade_ui.cjs)
- ✅ T3.5 รับชำระ/จ่ายชำระ: core `SETTLE_KINDS` (doc-calc.ts) + `settlementTotals` + RE/PS ใน buildPosting ลงผลต่าง (RE Dr PREPAID_TAX/SALES_DISCOUNT Cr INTEREST_INCOME · PS Cr WHT_PAYABLE/PURCHASE_DISCOUNT Dr INTEREST_EXPENSE) — posting-compare DEMO ดีขึ้นเป็น 14,931/15,382 (97.1%)
  - API `modules/docs/settle.ts`: /ar-receipts /ap-payments (+ /open-items?party_id&receipt_id, /:id/cancel) — doc_settlement.amount เป็นบวกเสมอ express_rectype 3/4/5 (5 = ใบลดหนี้ เครื่องลงบัญชีกลับเครื่องหมาย) · เช็คจากวิธีชำระ creates_cheque → fin_cheque status 00 (แก้/ยกเลิกได้เมื่อยังไม่นำฝาก/ผ่าน) · PS ป้อนภาษีหัก ณ ที่จ่ายได้ 2 กลุ่ม → tax_wht_entry (เลขที่หนังสือรับรองเริ่มต้น = เลขที่เอกสาร)
  - API `modules/wht.ts`: /wht (แฟ้ม + เพิ่มเอง/แก้/ยกเลิก/printed) — รายการจากเอกสารแก้ยอดเงินไม่ได้
  - migration 0012: doc_header.payment_date + แก้ v_ar/v_ap_outstanding: ใบลดหนี้ที่ตัดแล้วเคยคิดลบซ้ำ (ลูกหนี้ DEMO ต่าง 3.27 ล้าน) + ไม่นับใบเสร็จ/ใบสำคัญที่ยกเลิก → ลูกหนี้ใบกำกับ DEMO = 29,898,801.25 ตรง Express, ใบลดหนี้ค้าง −61,808.53 · `activeSettlement()` ใน engine ใช้กันแก้/ยกเลิกบิลที่ชำระแล้ว
  - หน้าจอ `pages/docs/SettleDocs.tsx` (ติ๊กบิลค้างในแท็บแรก ยอดเปลี่ยนได้ · ชำระโดยอื่น · แท็บภาษีหัก ณ ที่จ่าย → ปุ่ม 🖨 50 ทวิ) · `pages/tax/WhtRegister.tsx` (/tax/wht) · Wht50 รับ ?entry= เติมข้อมูลจากรายการ · DocJournalTab ใช้ร่วมกับ TradeDocs
  - แก้ MoneyInput (ui.tsx) ส่งค่าทันทีที่พิมพ์ — เดิมกด F9 ขณะอยู่ในช่องเงินจะบันทึกค่าเก่า
  - เหลือ: ใช้ยอดคงเหลือในเช็คครั้งก่อน (P4 ทะเบียนเช็ค) · พิมพ์ใบเสร็จ (P5) · แบบยื่น ภ.ง.ด.3/53 (T3.9)
  - ⚠️ server ทดสอบเสิร์ฟ apps/web/dist ที่ build ไว้ — แก้หน้าจอแล้วต้อง `pnpm --filter @buddy/web build` ก่อนทดสอบ (scratchpad/settle_ui.cjs)
- ✅ T3.6 มัดจำ/รายได้-ค่าใช้จ่ายอื่น: core `CASH_KINDS` (doc-calc.ts) · API `modules/docs/cashdocs.ts` /ar-deposits /ap-deposits /other-income-docs /other-expense-docs (+cancel) + /deposits/open
  - ส่วนชำระใช้ร่วม `modules/docs/payments.ts` (loadMethods/writePayments/writeWht/releaseCheques/readMoneyParts) — settle.ts ใช้ด้วย · หน้าจอใช้ร่วม `pages/docs/MoneyParts.tsx` (PaymentsTable/WhtTable)
  - หักมัดจำในบิล IV/HS/RR/HP: body.deposits → doc_link DEPOSIT (amount ตามประเภทราคาของบิล) · มัดจำคงเหลือ = view v_deposit_outstanding (migration 0013) · ประเภทราคาต้องตรงกัน · มัดจำที่หักแล้วยกเลิก/ลดยอดไม่ได้
  - เครื่องลงบัญชี: AE/OE Cr WHT_PAYABLE · AI/OI Dr PREPAID_TAX · HS วิธีรับชำระอื่นลงบัญชีของวิธีนั้น (เดิมลงเงินสดทั้งหมด) · HP หักมัดจำ Cr DEPOSIT_PAID → posting-compare 14,964/15,382 (97.3%)
  - OI/OE ไม่ระบุคู่ค้าได้ (party_name) · รหัสบรรทัด OI = item_type 4 · OE = 5 หรือ 2 (ข้อมูล Express) · /item-search?types=
  - ⚠️ มัดจำคงเหลือของข้อมูลที่ย้ายมาไม่ตรง REMAMT ของ Express (AE: view 39.9 ล้าน vs Express 16.3 ล้าน) เพราะ Express หักมัดจำผ่านวิธีชำระ "หัก เงินมัดจำ" ในใบสำคัญจ่ายโดยไม่ผูกใบ — แก้ใน T3.10 (importer สร้าง doc_link ปรับปรุงให้คงเหลือ = REMAMT)
- ✅ T3.7 ส่วนที่ 1: ใบเสนอราคา/ใบสั่งขาย/ใบสั่งซื้อ: เพิ่มใน `TRADE_KINDS` (order: 'SO'|'PO' — หัวเอกสาร module SO/PO, ไม่ลงบัญชี) ใช้ TradeFormPage เดียวกัน · IV/HS อ้าง SO, RR/HP อ้าง PO (`orderRef`, ปุ่ม/F6 → OrderPicker) บรรทัดบิลเก็บ `source_line_id`
  - ยอดค้างส่ง/รับ = view `v_order_line` (migration 0014): สั่ง − ยกเลิก − ส่งแล้ว · บรรทัดที่ย้ายจาก Express ใช้ remaining_qty (REMQTY) เป็นยอดตั้งต้น และการยกเลิกยอดบรรทัดเหล่านี้ลด remaining_qty ด้วย
  - /api/v1/orders/open?cls&party_id&invoice_id · POST /{sales-orders|purchase-orders}/:id/lines/:lineId/cancel (qty, reason_code ตาราง 42/43, date) · ใบสั่งที่มีบิลอ้างแล้วแก้/ยกเลิกทั้งใบไม่ได้
  - ✅ ส่วนที่ 2: `modules/docs/bills.ts` + core `BILL_KINDS` — /ar-bills /ap-bills (+open-items, /:id/appointment, cancel) doc_bill_item ยอดค้าง ณ วันทำใบ · บิลหนึ่งใบอยู่ในใบวางบิลที่ไม่ยกเลิกได้ใบเดียว · ref_date = วันที่ไปวางบิล · หน้า `pages/docs/BillDocs.tsx` (+ /fi/ar/bill-appointments = S-BI-02)
  - POST /quotations/:id/convert → ใบสั่งขาย (ใช้ saveTrade, doc_link CONVERT) · ใบเสร็จ/ใบจ่ายแสดงใบวางบิล# (settle openItems.bill_no)
  - เหลือใน T3.7: สถานะใบเสนอราคา (ตาราง 44 — ยังไม่มีคอลัมน์), อ้างใบเสนอราคาในบิลขายโดยตรง
- ✅ T3.8 เงินสดย่อย: `modules/docs/pettycash.ts` /petty-payments (DP, ไม่ลงบัญชี, บรรทัด line_kind G + account_id) /petty-reimbursements (VR, รวม DP ตามบัญชี/แผนก → ลงบัญชี) · DP→VR ผูก doc_link REIMBURSE (ข้อมูลที่ย้ายมาใช้ DP.ref_no = เลขที่ VR) · เครื่องลงบัญชีเพิ่ม VR (Dr บัญชีของบรรทัด / Cr เงินสด-วิธีจ่าย) — ตรง Express 68/68 · posting-compare รวม 15,032/15,450 (97.3%)
  - loadPostingInput โหลดบรรทัด G (account_id) ด้วย — ใช้เฉพาะ VR · หน้า `pages/docs/PettyCash.tsx` (/gl/petty-cash, /gl/petty-cash/vr)
  - เหลือ: ประเภท/สถานะเงินสดย่อย (ตาราง 53), แท็บภาษีซื้อของ DP (T3.9)
- ✅ T3.9 แฟ้มภาษีซื้อ/ขาย: `modules/vat.ts` — `syncVatEntries` เรียกใน postDocument (ก่อนเช็ค gen.link_gl) สร้าง/แทน tax_vat_entry ของเอกสาร (S: IV HS DR CN AI OI RE · P: RR HP CP DN AE OE PS · เกณฑ์เงินสดเกิดที่ RE/PS จาก doc_settlement.vat_amount) · cancelDocument → รายการ C
  - ยอดเก็บเป็นบวกแบบ Express — CN/DN แสดง/รวมเป็นลบ (sign จาก doc_class) · รายการที่ผู้ใช้แก้ (is_modified) คงเลขที่/วันที่ใบกำกับ งวด ยื่นเพิ่มเติม หมายเหตุ เมื่อบันทึกเอกสารซ้ำ (ยอดเท่าเดิม = คงทั้งแถว)
  - API /vat/P|S (+ /:id PUT แก้/ย้ายขอคืนไม่ได้, POST เพิ่มเอง, /:id/cancel เฉพาะเพิ่มเอง) สิทธิ์ FI.VAT.IN / FI.VAT.OUT · หน้า `pages/tax/VatRegister.tsx` (/tax/vat/P, /tax/vat/S) + พิมพ์รายงานแบบมาตรฐาน (portal .vat-print)
  - บิลซื้อ/ซื้อสด: ช่องเลขที่ใบกำกับผู้จำหน่าย/ลงวันที่ (ref_no/ref_date) → แฟ้มภาษีซื้อ
  - เหลือ: T1.15 JV ปรับปรุงภาษีประจำเดือน, แยกรายงานตามประเภทบิล, ภาษีซื้อของเงินสดย่อย DP
- ✅ T1.15: GET /api/v1/gl/vat-closing?month → รายการปิดภาษีขาย/ซื้อจากยอดคงเหลือ (leafTotals) ณ สิ้นเดือน + ผลต่างเข้า VAT_PAYABLE/VAT_REFUND (บทบาทใหม่ — GL_ROLES 36, ผังตัวอย่าง th_en แมป 2137-00/1156-00; DEMO ยังไม่ได้แมป → บรรทัดสุดท้ายว่างให้เลือกบัญชี) · ปุ่ม % ใน JournalForm (ใบสำคัญใหม่)
- ✅ T3.10: importer — เอกสารที่สร้างจากบัตรสต๊อก (ไม่มีใน ARTRN/APTRN) เป็น module IC/PC ไม่เข้าลูกหนี้/เจ้าหนี้ (RR0000064 = ต้นเหตุ 7,454.69) · ปรับยอดตัดของใบลดหนี้ (NETAMT − REMAMT) และมัดจำคงเหลือ = REMAMT ผ่านเอกสาร MIG-ADJ-AR/AP (doc_link DEPOSIT ปรับปรุง) → DEMO (สร้างใหม่) ตรง Express ทุกยอด, งบทดลองเท่าเดิม, posting-compare 97.3%
  - ลูกหนี้/เจ้าหนี้ยกมา: doc_header.is_opening (migration 0015) · `modules/docs/opening.ts` /ar-opening /ap-opening (เลขที่ป้อนเอง วันที่ก่อนปีบัญชีแรกที่ยังเปิด ยอดเงินอย่างเดียว) · postDocument/syncVatEntries ข้ามเอกสารยกมา · cancelDocument ไม่ตรวจงวดของเอกสารยกมา · trade แก้เอกสารยกมาไม่ได้ · หน้า `pages/docs/OpeningDocs.tsx`
- ✅ T3.11: GET /customers|suppliers/:id/activity (ยอดรายงวดของปีบัญชี คำนวณสดจาก doc_header ไม่รวมยกมา/ยกเลิก + ยอดต้นปี + เช็ค status 00 ที่ยังไม่ผ่าน) · แท็บ ยอดรายงวด / เช็คที่ยังไม่ผ่านบัญชี ใน Parties.tsx
- **P3 ครบทุกงานแล้ว (29/10/2569)**

**P4 เริ่มแล้ว (เจ้าของสั่ง "เริ่ม P4" 29/10/2569) — แผน T4.1–T4.8 ใน TASKS.md**
- ✅ T4.1 ยอดสต๊อก: view `v_stock_move` (บรรทัดเอกสาร stock_effect ≠ 0: qty = base_qty × stock_effect, value = cost_amount × stock_effect ยกเว้น movement 8 = cost_amount ตามเครื่องหมาย) + `v_stock_balance` (migration 0016) · API `modules/stock.ts` /stock/balances /stock/card · หน้า `pages/inventory/Stock.tsx` (/ic/stock, เมนู IC.STOCK)
  - STLOC ของ Express 158 คู่ไม่ตรงกับความเคลื่อนไหวใน STCRD ของตัวเอง (ตรวจจาก DBF แล้ว) → importer สร้างใบปรับปรุง MIG-ADJ-IC (JU, movement 8) ให้ยอดสดเท่า STLOC ทั้งจำนวนและมูลค่า → DEMO (สร้างใหม่อีกครั้ง) ตรง 11,802/11,802 คู่ งบทดลองเท่าเดิม
  - inv_stock_balance (STLOC ที่นำเข้า) เก็บไว้ตรวจเทียบเท่านั้น ไม่ใช้ในโปรแกรม · inv_stock_ledger/inv_cost_layer ยังไม่ใช้
- ✅ T4.2: trade.ts `STOCK_MOVE` (IV/HS 9 −, CN 2 + เฉพาะติ๊กคืน, RR/HP 0 +, DN 7 − เฉพาะติ๊กคืน) เฉพาะ item_type 0 · คลัง = บรรทัด → หัวเอกสาร → ic.main_warehouse → คลังแรก · รับเข้าจากซื้อ = net_amount ของบรรทัด (ก่อน VAT หลังส่วนลด) · จ่าย/รับคืน = ต้นทุน ณ วันที่เอกสาร (`modules/docs/stockcost.ts` + core `averageCost`/`fifoCost` — FIFO คำนวณสดจากประวัติรับเข้า, กลุ่มบัญชี cost_method F) · ตรวจติดลบเมื่อ ic.allow_negative ≠ Y และระดับ ≠ 0
  - Perpetual: buildPosting `perpetualCost` IV/HS Dr COGS/Cr INVENTORY, CN กลับด้าน, DN ส่งคืนเครดิตบัญชีสินค้า · loader ส่ง cost_amount/stock_effect · DEMO = PERIODIC → parity 97.3% เท่าเดิม · บริษัททดสอบ (ค่าเริ่มต้น PERPETUAL) ทดสอบเดิมอัปเดตให้มีบรรทัดต้นทุนขาย
  - แก้เอกสาร = ลบบรรทัดเดิมแล้วคิดต้นทุนใหม่ · เอกสารย้อนหลังไม่คิดต้นทุนของรายการจ่ายที่ตามมาใหม่ (บันทึกไว้ — งานคำนวณต้นทุนย้อนหลังค่อยพิจารณา) · ยังไม่ทำ: สินค้าชุดตัดส่วนประกอบ, เตือนขายต่ำกว่าทุน
- ✅ T4.3 รายการประจำวันสินค้า: `modules/docs/stockdocs.ts` (STOCK_KINDS ใน core: /stock-issues OU, /stock-transfers RL, /stock-adjustments JU, /cost-adjustments CA + /stock/lots) · หน้า `pages/docs/StockDocs.tsx` (/ic/issues /ic/transfers /ic/adjustments /ic/cost-adjustments, เมนู IC.TRN)
  - OU movement 6 (−) ต้นทุนตามวิธีของกลุ่ม · RL เก็บคู่บรรทัด ออก 4 (คลังต้นทาง) + เข้า 3 (คลังปลายทาง) ต้นทุนเดียวกัน — รายละเอียดแสดงเฉพาะบรรทัดออก · JU movement 8 qty เก็บ abs + stock_effect ตามเครื่องหมาย, cost_amount มีเครื่องหมาย (เพิ่ม = จำนวน × ทุนที่ป้อน, ว่าง = เฉลี่ย) · CA movement 5 qty 0 มูลค่า ± (FIFO ต้องอ้างล็อต source_line_id → issueCost FIFO บวกมูลค่า CA เข้าล็อตนั้น)
  - ลงบัญชี (core buildPosting OU/JU/CA): Perpetual หรือ OU ที่ประเภทเอกสารกำหนดบัญชี ISSUE_DEBIT/ISSUE_CREDIT ครบ (Express ลง OU แม้ Periodic → parity OU 17/17) · JU slot ADJ_DEBIT/ADJ_CREDIT → OTHER_EXPENSE/OTHER_INCOME · CA slot COST_ADJ → SUSPENSE · รวม parity 97.3%
  - ใบ MIG-* (ปรับยอดตอนย้ายข้อมูล) แก้/ยกเลิกไม่ได้ · จ่ายวัตถุดิบผลิต/ตัวอย่าง/ชำรุด/รับสำเร็จรูป/ค่าขนส่ง = ประเภทเอกสารอีกรหัสในหมวดเดียวกัน (replaced)
- ✅ T4.4 ตรวจนับ: `modules/docs/stockcount.ts` (/stock-counts dates/prepare/rows/entries/adjust/reopen) · หน้า `pages/inventory/Counts.tsx` (/ic/counts เมนู IC.COUNT) · ตาราง inv_stock_count (มีอยู่แล้วใน baseline, flag 1/3/6, counted_qty null = ยังไม่นับ)
  - ยอดตามระบบ ณ วันนับคำนวณสดจาก v_stock_move · ปรับปรุง = `writeStockDoc` (stockdocs.ts, ใน transaction เดียวกัน) สร้างใบ JU (ประเภท TK ถ้ามี) ณ วันนับ qty = นับ − ระบบ (allowZero) แล้วบันทึก adjust_line_id/system_qty/diff_qty
  - ใบที่มาจากการตรวจนับแก้ไม่ได้ (`countLinked`) · ยกเลิกใบ (จากหน้าตรวจนับ reopen หรือหน้าปรับปรุง) → `cancelStockDoc` คืนผลนับเป็น flag 3
  - ยังไม่ทำ: นำเข้าประวัติ STTAK ของ Express (20,189 แถว ส่วนใหญ่ 31/12/2551 — ใบ TK นำเข้าเป็น JU แล้ว ยอดสต๊อกไม่กระทบ)
- ⚠️ server ทดสอบ 4101 ย้ายไป `scratchpad/buddy-test2` (buddy-test เดิม PGlite เสียหลังถูกฆ่ากลางทาง) — ฆ่า process ที่ค้างพอร์ตก่อนเปิดใหม่ทุกครั้ง; ฐานใหม่ไม่มีบริษัท สคริปต์ต้องสร้างบริษัทเอง (scratchpad/count_ui.cjs)
- ✅ T4.5 ยอดยกมาสินค้า: `modules/docs/stockopening.ts` (/stock-opening) หมวด **OS** is_opening ประเภทเอกสาร `OPEN-IC` (สร้างเมื่อใช้ครั้งแรก) · 1 ใบ = 1 ล็อต (เลขที่+วันที่ก่อนวันเริ่มใช้) movement 1 มูลค่า = ที่ป้อน · ไม่ลงบัญชี · หน้า `pages/inventory/StockOpening.tsx` (/ic/opening เมนู IC.OB)
  - **importer แก้แล้ว**: ใบยกมาสังเคราะห์ "OB-ปี" เคยไปจับประเภท OB ของ Express (= ใบเบิก OU) จึงโผล่ในหน้าจ่ายใช้ภายใน → ตอนนี้เป็นหมวด OS ประเภท OPEN-IC is_opening (DEMO สร้างใหม่แล้ว)
  - ทะเบียนหมายเลขสินค้า: `modules/serials.ts` (/serials + /:id/printed) migration 0017 (ref_code, customer_name, salesperson_id, print_count, last_printed_at) · หน้า `pages/inventory/Serials.tsx` (/ic/serials) บัตรรับประกัน + รายงานประวัติบริการ · TESTRice ไม่มีข้อมูล ISSN (0 แถว)
- ✅ T4.6 ธนาคาร: core `BANK_KINDS` (BD BW BT BU BV) + buildPosting สาขาเอกสารธนาคาร (บรรทัด line_kind G = บัญชี GL ของบัญชีเงินฝาก ยอด +เข้า/−ออก; อีกฝั่ง CASH/BANK_CHARGE/BANK_INCOME+PREPAID_TAX/BANK_EXPENSE→BANK_CHARGE) · `modules/docs/bankdocs.ts` + /bank-book · migration 0018 doc_header.to_bank_account_id · หน้า `pages/docs/BankDocs.tsx` (/fi/bank/deposits|withdrawals|transfers|incomes|expenses + /fi/bank/book) · journal route BANK_MOVEMENT
  - สมุดเงินฝาก = `ledgerOf` (แยกจาก /reports/ledger ใน gl/reports.ts) ของบัญชี GL ที่ผูก — ตรวจแล้ว BKTRN ของ Express ไม่ครบ (รายการรับ/จ่ายผ่านบัญชีหลายรายการอยู่แค่ใน GL) จึงไม่ใช้ fin_cheque เป็นสมุด
  - DEMO ไม่มีหัวเอกสาร BD/BW/BT ของ Express (โอน BT/Bx อยู่ใน BKTRN → fin_cheque ไม่มีเอกสารต้นทาง 431 แถว) parity คงเดิม
- ✅ T4.7 เช็ค: `modules/cheques.ts` (/cheques list/detail/add/edit/delete/deposit/undeposit/pass/unpass/return/write-off + /cheque-deposits BQ) · หน้า `pages/docs/Cheques.tsx` (/fi/cheques/received|paid|deposit|pass|pass-paid|slips)
  - ผ่านเช็ค = ใบสำคัญ source_module BK (createJournal รองรับ transaction ของผู้เรียก + opt.sourceModule): รับ Dr เงินฝาก+ค่าธรรมเนียม / Cr บัญชีของวิธีชำระที่รับเช็ค (→ CHEQUE_RECEIVED) · จ่าย Dr บัญชีวิธีชำระ (→ CHEQUE_PAID) / Cr เงินฝาก · BQ ผ่านทั้งใบ (+ภาษีซื้อ/ภาษีถูกหัก)
  - เช็คคืน = fin_cheque_event (20) + สถานะ 02 (ไม่สร้างแถวซ้ำแบบ Express) · ตัดยอดคงเหลือ = migration 0019 written_off_amount/writeoff_journal_id (Express REMCUT)
  - เช็คจ่ายที่สร้างจากใบจ่ายตอนนี้สถานะ 05 (เดิม 00) · สิทธิ์ตามทิศทาง: permissions `CHQ(rMenu, pMenu)` เลือกเมนูจาก direction/เช็คที่อ้างถึง (Rule.pick)
  - importer: แถวซ้ำทุกช่องใน BKTRN ได้ id ต่างกัน (เดิมหาย 1 แถว) → ทะเบียนเช็คตรง Express 1,193/1,193 (scratchpad/cheque_compare.py) · DEMO สร้างใหม่แล้ว
- ✅ T4.8: migration 0020 (ตาราง gl_inventory_balance + fin_bank_statement มี RLS, gl_journal_line.bank_cleared_date)
  - บัญชีสินค้าคงเหลือ `modules/gl/inventory.ts` (/gl/inventory-accounts, /gl/inventory GET/PUT, /compute) หน้า `pages/gl/InventoryAccount.tsx` (/gl/inventory เมนู GL.INV) · งบการเงิน INV: `statementContext` ใช้ยอดที่ยืนยัน (invOf) ไม่มี = ยอดบัญชี (เหมือน Express GLINV) · ยอดระบบสินค้า = v_stock_move ของสินค้าที่กลุ่มผูกบัญชีนี้ (+บัญชี INVENTORY ของบัญชีเพื่อลงรายวันรวมสินค้าไม่ผูก)
  - GLINV ของ TESTRice มีแถวเดียวยอดศูนย์ทั้งหมด → ไม่นำเข้า (ถ้านำเข้าศูนย์ งบจะเปลี่ยน) · DEMO ยังไม่มียอดที่ยืนยัน งบเท่าเดิม
  - กระทบยอดเงินฝาก `modules/bankrecon.ts` (/bank-recon, /statement, /clear) หน้า `pages/docs/BankRecon.tsx` (/fi/bank/reconcile เมนู FI.BK.REC): ยอดตามบัญชี − เงินฝากระหว่างทาง + จ่ายที่ธนาคารยังไม่ตัด = ยอด statement · รายการก่อน "ตั้งแต่" (ต้นปีบัญชี) ถือว่ากระทบแล้ว · แก้ใบสำคัญ GL = บรรทัดใหม่ ต้องติ๊กใหม่
- **P4 เสร็จครบ T4.1–T4.8** (29/10/2569) — เกณฑ์: สต๊อกตรง STLOC 40,768/40,768 คู่ · ทะเบียนเช็คตรง BKTRN 1,193/1,193 · งบทดลองเท่าเดิม 2569/2568 · parity 97.3%
- ⚠️ server ทดสอบ PGlite: TaskStop ปิดแค่ shell แต่ node ยังฟังพอร์ต และการ Stop-Process ทำให้ข้อมูล PGlite เสีย (เป็นแล้ว 2 ครั้ง) → ใช้โฟลเดอร์ใหม่ได้เสมอ: `BUDDY_DATA_DIR=<scratchpad>/buddy-testN pnpm --filter @buddy/server cli create-admin admin "ผู้ดูแลระบบ" buddy1234` (ล่าสุด buddy-test3 ซึ่งอาจเสียแล้ว) — สคริปต์ UI สร้างบริษัทเอง (scratchpad/t48_ui.cjs)
- ✅ งานค้าง P4 (เจ้าของสั่ง "Clear P4 leftovers"): สินค้าชุดตัด/รับสต๊อกที่ส่วนประกอบ — trade.ts `explodeKit` (ชุดซ้อนชุดแตกต่อ) สร้างบรรทัด line_kind **K** (migration 0021) อ้างบรรทัดชุด, ขาย/รับคืนคิดทุนตามวิธีของกลุ่ม, ซื้อเฉลี่ยยอดซื้อตามราคาทุนมาตรฐานของส่วนประกอบ (allocateKit), loader ลงบัญชีรวมบรรทัด K (Perpetual ต้นทุนขาย) · หน้าเอกสารไม่แสดงบรรทัด K · ชุดพิเศษ (2) ยังตัดทุกส่วนประกอบ (ยังไม่มีให้เลือกบางรายการ) · ขายต่ำกว่าทุนเตือน (ar.warn_below_cost) คืน `warnings` แล้วหน้าจอแสดง toast
- ✅ ผ่านเช็คจ่ายทันที (fn.auto_pass_cheque_paid): writePayments ผ่านเช็คจ่าย (วิธีชำระชนิด CHEQUE) ตามวันที่เช็คด้วย `passOne` (เหตุผลในประวัติ = AUTO_PASS) · releaseCheques ยกเลิกการผ่านอัตโนมัติก่อนแก้/ยกเลิกเอกสารต้นทาง
- ✅ ใบขายลดเช็ค SQR: ใบนำฝาก BQ ที่ express_rectype = 'S' (ref_no/ref_date = ใบกำกับภาษีซื้อ) ผ่านทันทีวันที่ขายลด (`passSlip`) ค่าขายลด (discount_amount) ลง INTEREST_EXPENSE
- ✅ ยอดคงเหลือในเช็ค: ใบเสร็จป้อน "หน้าเช็ค" มากกว่ายอดชำระได้ (cheque_amount → fin_cheque.amount, remaining = ส่วนเกิน) · ใบถัดไปเลือก "ใช้ยอดคงเหลือในเช็คเดิม" (cheque_id) ลด remaining ในทรานแซกชันเดียวกัน · releaseCheques คืนยอดให้เช็คเดิม และห้ามยกเลิกใบที่ออกเช็คถ้ายอดคงเหลือถูกใช้ในใบอื่น · ลงบัญชี: ใบเสร็จ Dr บัญชีเช็ครับเฉพาะยอดที่ใช้ ผ่านเช็ค Cr เต็มใบ (ส่วนต่างรอใช้/ตัดเป็นรายได้)
- ✅ คิดต้นทุนย้อนหลังอัตโนมัติ: `recostAfter` (stockcost.ts) เรียกหลังบันทึก trade/เอกสารคลัง/ยอดยกมา และใน cancelDocument — ไล่รายการจ่าย (9 6 4 7 8− และรับคืน 2) ของสินค้าที่เกี่ยวข้องตั้งแต่วันที่เอกสาร คิดใหม่ด้วย issueCost (excludeHeaderId) อัปเดตบรรทัด (+โอนเข้าคู่กัน) ยอดหัวเอกสารคลัง และลงบัญชีใหม่ (ไม่มีเมนูคำนวณใหม่)
- ✅ นำเข้าประวัติตรวจนับ STTAK → inv_stock_count (importer หลังบรรทัด STCRD): สถานะ 1/3/6 · สถานะ 6 อ้างบรรทัดใบ TK ด้วย DOCNUM+SEQNUM (DEMO มีบรรทัดจริง 1,191 แถว ที่เหลือผลต่าง 0 ไม่มีบรรทัด — คงสถานะ 6 ไม่ให้ปรับซ้ำ)
- งานค้าง P4 ทั้งหมดเสร็จแล้ว · ยังเหลือเล็กน้อย: ชุดพิเศษ (2) เลือกขายเฉพาะบางส่วนประกอบ, แบบฟอร์มพิมพ์เช็คตามธนาคาร (บทที่ 25)
**P5 เริ่มแล้ว (เจ้าของสั่ง "Start P5" 29/10/2569) — แผน T5.1–T5.9 ใน TASKS.md**
- ✅ T5.1 ศูนย์รายงาน: core `packages/core/src/reports.ts` (REPORT_TREE รหัสตาม Express, ReportFilter, ReportResult, REGISTER_GROUPS/registerOf) · server `modules/reports/index.ts` (`defineReport(codes, runner)`, POST /api/v1/rpt/:code/run, GET /rpt/available, class `P` อ่านขอบเขต + dept wildcard + วันที่ พ.ศ.) · สิทธิ์ตามเมนูของกลุ่ม (Rule.pick → def.menu: RP.SA RP.PU RP.IC RP.CHQ RP.GL RP.TAX) · หน้า `pages/reports/ReportCenter.tsx` (/reports/center?g=กลุ่ม) ส่งออก Excel(SpreadsheetML)/CSV/ข้อความ พิมพ์ A4 ตามแนวรายงาน
  - ทะเบียนเอกสาร `modules/reports/register.ts`: กลุ่ม 1.1–1.9, 1.G, 2.1–2.9 ทุกโหมด (เลขที่ วันที่ คู่ค้า พนักงานขาย เขต ถึงกำหนด) ไม่นับเอกสาร module IC · ใบลด/ส่งคืนยอดติดลบ · ยกเลิกแสดงได้แต่ไม่รวม
  - เพิ่มรายงานใหม่: เพิ่ม leaf ใน REPORT_TREE (core) + defineReport ใน server — หน้าจอเปิดใช้เองตาม /rpt/available
- ✅ T5.2/T5.3 `modules/reports/parties.ts` (ทั่วไปทั้งลูกหนี้/เจ้าหนี้): คงค้าง ณ วันที่ 1.A/2.A สรุป/ละเอียด (ยอดตัดนับวันที่ใบเสร็จ/ใบจ่าย หรือใบสำคัญ Express) · อายุหนี้ 1.C/2.C (6 ช่วงตามวันครบกำหนด) · สถานะรายงวด 1.B/2.B แยกประเภท · เคลื่อนไหว 1.D/2.D · เกินวงเงิน 1.E/2.E · รายละเอียดคู่ค้า 1.F/2.F · ตรวจสอบข้อมูล 1.H/2.G · ใบยืนยันยอด 1.4.A/2.4.6
  - DEMO ณ 31/12/2569: ลูกหนี้ 29,866,992.72 (= IV 29,898,801.25 − CN 31,808.53) · เจ้าหนี้ 20,210,798.24 (= RR 20,221,892.00 − DN 11,093.76) ตรง Express · 1H/2G พบเอกสารปี 2566 ที่ Express ไม่ได้ลงบัญชี (จริง)
- ✅ T5.4 `modules/reports/stock.ts`: เช็ค 3.1–3.7, 3.A, 3.B (ทะเบียน fin_cheque เฉพาะ CHEQUE + ประวัติเช็คคืน) · สินค้า 4.1.1/4.1.5 แจกแจงรับ-จ่าย (ยกมา+รายการ+คงเหลือ) 4.2.1/4.2.7 คงเหลือ ณ วันที่ 4.3 ต่ำกว่าจุดสั่งซื้อ 4.4 ใบเบิก/โอน/ปรับปรุง 4.5 รายละเอียดสินค้า · DEMO 4.2.x = STLOC (7,446,586.076 / 33,155,393.99) · 3.1 = BKTRN เช็ครับในมือ 4 ใบ 410,919.00
- ✅ T5.5 `modules/reports/gl.ts`: 5.1 ผังบัญชี · 5.3 สรุปยอดเคลื่อนไหว (= งบทดลอง, DEMO เดบิตปี 2569 825,161,742.82) · 5.7 งบประมาณเทียบจริง · 5.8 กระดาษทำการ (งบทดลอง 245,718,317.16 → กำไร 16,136,699.09) · 5.A.1/2/3 ตรวจสอบข้อมูล (S-CK-04) · 5.C เงินสดย่อย (ใบยกมาใช้ ref_no เป็นเลขใบเบิก)
- ✅ T5.6 `modules/reports/analysis.ts`: 7.1.1/2/3 ประวัติการขาย (ลูกค้า/สินค้า/พนักงานขาย) 7.6 สรุปยอดขาย (สินค้า/ลูกค้า/พนักงาน/เดือน + ต้นทุน กำไรขั้นต้น %) 8.1/8.2 ซื้อ · ใช้ยอดบรรทัดก่อน VAT (หัวเอกสาร price_type 1 ของ Express เก็บยอดรวม VAT — ทะเบียนเอกสารแสดงตามหัว) · ต้นทุนรวมส่วนประกอบชุด (บรรทัด K)
- ✅ T5.7 `modules/reports/tax.ts`: 6.1 สรุป VAT · 6.2/6.3 รายงานภาษีซื้อ/ขาย (มาตรฐาน แยกขอคืนได้/ไม่ได้ อัตราศูนย์ แยกประเภทบิล ไม่มีรายการ · ยื่นปกติ/เพิ่มเติม) · 6.4 ภ.พ.30 ข้อ 1–12 (ยกมาชำระเกินคำนวณไล่จากงวดก่อน หรือเลือกไม่มี; ยอดขายยกเว้น = เอกสารขายไม่มี VAT ที่ไม่อยู่ในแฟ้มภาษี) · 6.5/6.6 ใบแนบ ภ.ง.ด.3/53
  - ไฟล์ยื่นทางอินเทอร์เน็ต: GET /api/v1/wht/efile?form&month (ข้อความคั่น | — โครงสร้างในคอมเมนต์ wht.ts) ปุ่มที่ /tax/wht · **ยังไม่ได้ตรวจกับโปรแกรม RD Prep จริง** ต้องให้เจ้าของ/สำนักงานบัญชีลองนำเข้าก่อนยื่น
- ต่อไป: T5.8 แบบฟอร์มเอกสาร (S-RD-01..06, T0.11)

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
- ทดลองหน้าจอที่ "บันทึก" ข้อมูล: ใช้ server ทดสอบแยก (PGlite, `BUDDY_DATA_DIR=<scratchpad>/buddy-testN PORT=4101` (สร้างใหม่ได้ด้วย cli create-admin), admin/buddy1234) อย่าเขียนข้อมูลลง DEMO
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
