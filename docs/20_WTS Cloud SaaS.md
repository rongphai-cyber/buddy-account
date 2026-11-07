# WTS Cloud SaaS — Buddy Account · WTS-POS · WTS-Living บน Cloudflare + Supabase (06/11/2569)

> แผนภาพรวมสำหรับเจ้าของ: หน้า "WTS Cloud SaaS" (claude.ai artifact) · เอกสารนี้ = แผนเดียวกันเขียนสำหรับโค้ดชุดนี้ + ผล S0
> เครื่องมือ: `tools/cloud/` (README มีขั้นตอนที่เจ้าของทำทีละคลิก) · repo อื่น: `E:\WTS-POS\tools\cloud`, `E:\WTS-Living\tools\cloud`

## 0. สถานะ S0 (07/11/2569)

| เรื่อง | ผล |
|---|---|
| เครื่องมือตรวจฐานข้อมูลคลาวด์ `tools/cloud/pg-check.mjs` | ✅ ซ้อมผ่านกับ PostgreSQL 16 ของ Buddy (ฐานชั่วคราว) และ PostgreSQL ชั่วคราวที่จำลองสิทธิ์ Supabase — รอเจ้าของสร้างโปรเจกต์ Supabase แล้วรันจริง |
| ชุดทดสอบรับมอบของ 3 repo บน PostgreSQL จริง | ✅ Buddy WTS Connect 6 ข้อ + S0 flow 3 ข้อ · POS B2.9 6 ข้อ · Living B5.2 2 ข้อ + B5.3 6 ข้อ — ยอดตรงทุกสตางค์เหมือนบน PGlite |
| RLS ด้วย role ของแต่ละโปรแกรม | ✅ `buddy_app` / `wtspos_app` / `wtsliving_app` ไม่มี BYPASSRLS · บริษัทอื่น = 0 แถว · เขียนข้ามบริษัทถูกปฏิเสธ |
| **พบและแก้**: PostgreSQL 16+ ผู้เชื่อมต่อที่ไม่ใช่ superuser (เหมือน role `postgres` ของ Supabase) สร้าง `buddy_app` แล้ว **SET ROLE ไม่ได้** → Buddy ตอบ 500 ทุกหน้าที่ใช้ข้อมูลบริษัท | ✅ migration `0061_app_role_set_grant.sql` + `rlsAvailable()` ลอง `SET LOCAL ROLE` จริง (ข้อ 4) — ยืนยันด้วยการจำลอง: ไม่มี 0061 = ล้ม 9/9 · มี = ผ่าน |
| Container: `Dockerfile` + `.dockerignore` + GitHub Actions `container` (สร้าง image + เปิดกับ PostgreSQL 16 ไม่ push ไม่ deploy) ทั้ง 3 repo | ✅ (เครื่องนี้ไม่มี Docker — ผลจริงดูที่ GitHub › Actions) · บูตแบบเดียวกับใน container บนเครื่องนี้แล้ว (ข้อ 11) |
| ที่เก็บไฟล์ Cloudflare R2 (ข้อ 9) | ✅ ตัวเก็บ `local`/`r2` ทั้ง 3 repo · SigV4 ผ่านชุดตัวอย่างของ AWS · ไฟล์ใหม่ขึ้น R2 เมื่อ `FILES_DRIVER=r2` · pg-check ตรวจ R2 ได้ — รอเจ้าของสร้าง bucket |

**ผลบน Supabase จริง (07/11/2569 · โปรเจกต์ทดสอบ wts-cloud-test ของเจ้าของ แผน Free · Singapore · PostgreSQL 17.11 · Session pooler + ใบรับรอง verify-full):** สร้าง s0_buddy/s0_wtspos/s0_wtsliving ผ่าน URL เดียว · migration 62/43/18 ครบ · Buddy 6+3 · POS B2.9 6 · Living B5.2 2 + B5.3 6 ผ่าน ยอดตรงทุกสตางค์ · RLS: buddy_app/wtspos_app/wtsliving_app ไม่ BYPASSRLS · บริษัทอื่น 0 แถว · กับดัก PG16+ SET ROLE เจอจริงบน Supabase และ 0061 แก้ได้ · role anon อ่านตารางไม่ได้ (ฐานแยกจาก postgres) · ความช้า: ทดสอบจากเครื่องนี้ (ไทย→สิงคโปร์ ผ่าน pooler) ช้ากว่าในเครื่อง ~3–20 เท่า (Living B5.3 849 วิ เทียบ 43 วิ) เพราะคำสั่ง SQL ทีละรอบ — S1 ต้องวาง container ใกล้สิงคโปร์ และวัดเวลาหน้าจอจริงก่อนเปิดให้ลูกค้า · ยังไม่ได้ตรวจ: Transaction pooler 6543 · R2 จริง · รายงาน `.data/cloud-s0-report.md`

## 1. สถาปัตยกรรม

```
ผู้ใช้ (เบราว์เซอร์/มือถือ/จอ POS)
   │ https
Cloudflare: DNS *.worktruesolution.net · WAF + Rate limiting · Turnstile (หน้าสมัคร/เข้าระบบ) · กฎ 404 หน้าหลังร้านบนโดเมนร้าน
   │
Worker (ตัวรับคำขอ + Cron Triggers) ──► Cloudflare Containers: 1 แอปต่อ 1 container class
   │                                       Buddy (4100) · WTS-POS (4200) · WTS-Living (4300) — image จาก Dockerfile ของแต่ละ repo
   │                                       POS/Living ↔ Buddy คุยผ่าน https + กุญแจ API (WTS Connect) เหมือนเดิม
   ├──► Supabase PostgreSQL (Singapore) — 1 โปรเจกต์ต่อโปรแกรม · RLS · สำรอง/PITR
   └──► Cloudflare R2 (APAC) — ไฟล์ของผู้ใช้ (รูป สลิป โลโก้ ลายเซ็น) bucket ปิดสาธารณะ อ่านผ่านโปรแกรม/ที่อยู่แบบเซ็นอายุสั้น
ลูกค้าติดตั้งในเครื่อง (Windows + PGlite/PG16) เปิดสู่อินเทอร์เน็ตด้วย Cloudflare Tunnel (`tools/tunnel`, `.data/cloudflared` — ไม่เปลี่ยน)
```

- **Supabase ใช้แค่ PostgreSQL** (+ สำรอง/PITR) ไม่ใช้ Supabase Auth / Data API / Storage — เข้าระบบ สิทธิ์ และ RLS อยู่ในโปรแกรมของเราแล้ว (docs/05) · ไฟล์ใช้ R2 (ไม่มีค่าโอนออก ราคาต่อ GB ต่ำกว่า และอยู่ใน Cloudflare เดียวกับ container)
- **ปิด Data API ของ Supabase** (Project Settings › API › ปิด "Enable Data API" หรือเอา `public` ออกจาก Exposed schemas) — Supabase ให้ role `anon`/`authenticated` มีสิทธิ์บนตารางใน `public` โดยอัตโนมัติ ตารางที่ไม่มี company_id (เช่น `md_lookup`, `sys_schema_migration`) จะอ่านได้ด้วยกุญแจ anon ถ้าเปิดไว้ · pg-check รายงานตารางที่ `anon` อ่านได้
- งานที่ต้องมีเครื่องเดียว (นำเข้า Express เก็บงานไว้ในหน่วยความจำ + โฟลเดอร์ชั่วคราว) → `max_instances = 1` จนกว่าจะย้ายงานไปเก็บในฐานข้อมูล

## 2. Cloudflare

| ส่วน | ใช้ทำอะไร | สถานะ |
|---|---|---|
| DNS + https | `app.` (Hub+Buddy) `pos.` `living.` + โดเมนร้านของลูกค้า (POS shop domain) | ➕ ตั้งตอน S1 |
| WAF / Rate limiting | กันยิงถี่ที่ `/api/v1/auth/*` `/api/v1/signup` `/shop/*/auth/*` (โปรแกรมมีกันซ้ำในตัวแล้ว: 5 ใบ/IP/ชม., ล็อก 5 ครั้ง) | ➕ S1 |
| Turnstile | หน้าสมัครใช้งาน + หน้าเข้าระบบหลังผิด 2 ครั้ง — ตรวจ token ที่ server (`/siteverify`) | ➕ S2 |
| Containers | รัน image ของแต่ละ repo · `sleepAfter` · `max_instances` · ความลับผ่าน Worker env → `envVars` | ✅ image พร้อม · ➕ worker (tools/cloud/README ข้อ 3) |
| Cron Triggers | ปลุก container ให้งานเบื้องหลังทำงาน (ข้อ 6) | ➕ S1 |
| Tunnel | เครื่องลูกค้าที่ติดตั้งเอง / เครื่องนี้ (DEMO, WTS Prep) จนกว่าจะย้ายขึ้นคลาวด์ | ✅ มีแล้ว |
| R2 | ที่เก็บไฟล์ (ข้อ 9) | ✅ โค้ด · ➕ bucket |

## 3. ฐานข้อมูล: 1 ฐานต่อโปรแกรม ในโปรเจกต์ Supabase เดียว (ไม่รวมเป็น schema ในฐานเดียว)

**เจ้าของเลือก (07/11/2569): 1 โปรเจกต์ Supabase + 3 ฐาน (`CREATE DATABASE`) — Buddy · WTS-POS · WTS-Living แยกฐานกัน** (ทดสอบ S0 = `s0_buddy` `s0_wtspos` `s0_wtsliving` · ใช้งานจริง S1 = `buddy` `wtspos` `wtsliving` · แยกโปรเจกต์ทดสอบ/ใช้งานจริง) แยกเป็น 1 โปรเจกต์ต่อโปรแกรมภายหลังได้ด้วย pg_dump/restore ทีละฐาน ลูกค้าหลายรายอยู่ในฐานเดียวกันของโปรแกรมนั้น แยกด้วย tenant/company + RLS (docs/05) · ลูกค้ารายใหญ่ย้ายไปโปรเจกต์ของตัวเองได้ (docs/11)

> **ค่าใช้จ่ายของการแยกโปรเจกต์ (ตรวจซ้ำ 07/11/2569 — ราคาตามที่ Supabase ประกาศ ต้องเช็กหน้า pricing อีกครั้งก่อนสมัคร):** แผน Free มีได้ 2 โปรเจกต์ (หยุดเมื่อไม่ใช้ 7 วัน) · แผน Pro $25/เดือน รวมเครดิต compute ที่พอสำหรับ 1 โปรเจกต์ขนาดเล็ก — โปรเจกต์ที่ 2–3 ราว $10/เดือนต่อโปรเจกต์ → 3 โปรแกรม ≈ $45/เดือน · ทางประหยัด 1 โปรเจกต์ + 3 ฐาน ≈ $25 (ข้อเสียตามบรรทัดสุดท้ายของหัวข้อนี้) — **เจ้าของเลือก 1 โปรเจกต์ + 3 ฐาน** · pg-check รองรับแล้ว (`SUPABASE_PROJECT_URL` · ซ้อม `--sim-supabase --one-project`)

เหตุผลที่ไม่รวมเป็น schema ในฐานเดียว
- ชนกันจริง: POS และ Living ต่างใช้ `public.schema_migration`, `core.*`, `ref_*` ใน public — ต้องแก้ทั้งสอง repo
- กฎเหล็กของ POS/Living "ฐานข้อมูลของตัวเองเท่านั้น" (คุยกับ Buddy ผ่าน API) — ฐานแยกบังคับด้วยโครงสร้าง
- สำรอง/PITR/กู้คืนเป็นรายโปรเจกต์: กู้ POS ย้อนเวลาไม่ทำให้บัญชีใน Buddy ย้อนตาม · ขนาดเครื่อง (compute) ปรับแยกได้
- role เป็นของทั้ง cluster: ชื่อแยกแล้ว (`buddy_app` `wtspos_app` `wtsliving_app`) จึงไม่ชนแม้อยู่โปรเจกต์เดียว
- 1 โปรเจกต์ + 3 ฐาน (ที่เลือก) ยังแยกตาราง/migration/role ครบ · ที่รวมกัน: เครื่อง (compute) · pooler · การสำรอง/PITR (กู้ย้อนเวลาทั้งโปรเจกต์ = ย้อนทั้ง 3 โปรแกรมพร้อมกัน — กู้โปรแกรมเดียวใช้ pg_dump รายฐานแทน) → เมื่อลูกค้าเกินราว 30 ราย หรือโปรแกรมใดโหลดสูง แยกโปรเจกต์
- Data API (PostgREST) ของ Supabase ให้บริการเฉพาะฐาน `postgres` — ฐานของโปรแกรมไม่ถูกเปิดผ่านกุญแจ anon (ยังควรปิด Data API)
- Session pooler (Supavisor) ต้องเลือกฐานจากชื่อท้าย URL ได้ — pg-check ตรวจ `current_database()` · ถ้าไม่ได้ ใช้ Direct connection (IPv6 หรือ IPv4 add-on) · โปรแกรมแต่ละตัวตั้ง `DATABASE_URL` ชี้ฐานของตัวเอง

## 4. Role และ RLS บน Supabase

ผู้เชื่อมต่อของ Supabase คือ `postgres` = **ไม่ใช่ superuser** แต่มี CREATEROLE · CREATEDB · BYPASSRLS (ซ้อมด้วย `pg-check --sim-supabase` ซึ่งสร้างสิทธิ์แบบเดียวกัน)

- migration สร้าง role `*_app` แบบ NOLOGIN แล้วมอบให้ผู้เชื่อมต่อ · ทุกคำขอข้อมูลบริษัท: ทรานแซกชัน → `SET LOCAL ROLE <app>` → `set_config('app.company_id' / 'app.tenant_id' / 'app.user_id', …, true)` · role นี้ไม่ใช่เจ้าของตารางและไม่มี BYPASSRLS จึงอยู่ใต้นโยบาย (เจ้าของ `postgres` ข้าม RLS ได้ — ใช้เฉพาะ migration/งานระบบ)
- **กับดัก PostgreSQL 16+ (Supabase โปรเจกต์ใหม่ = PG 17):** ผู้ใช้ CREATEROLE ที่สร้าง role ได้สิทธิ์ ADMIN แต่ `SET ROLE` ไม่ได้ (`createrole_self_grant` ว่าง) · 0007 ของ Buddy เช็ค `pg_has_role(…,'MEMBER')` ซึ่งเป็นจริง จึงข้าม GRANT → ทุกคำขอ "permission denied to set role buddy_app"
  - แก้: `0061_app_role_set_grant.sql` = `GRANT buddy_app TO current_user WITH SET TRUE` เมื่อ PG ≥ 16 และยัง SET ไม่ได้ · `rlsAvailable()` ลอง SET LOCAL ROLE จริงในทรานแซกชันที่ยกเลิกทิ้ง (ไม่ได้ = กรองในโค้ดอย่างเดียว + เตือนใน log แทนที่จะล้ม)
  - POS/Living GRANT ทุกครั้งใน 0001 (ไม่เช็ค MEMBER) จึงผ่านอยู่แล้ว — ยืนยันใน `--sim-supabase`
- **โฮสต์ที่สร้าง role ไม่ได้** (fallback ของ docs/05): Buddy ทำงานแบบกรองในโค้ดอย่างเดียว (ยังผ่านชุดทดสอบข้ามบริษัท) · POS/Living ต้องมี role (withTenant สลับ role ทุกคำขอ) → ใช้โฮสต์ที่สร้าง role ได้เท่านั้น (Supabase ได้)
- ตารางใหม่ที่มี company_id ต้องเปิด RLS ใน migration (ทุก repo) — pg-check รายงานตารางที่มี company_id แต่ไม่เปิด RLS (S0 = ไม่มี ทั้ง 3 repo)

## 5. Pooler กับ SET LOCAL

| ทางเชื่อมต่อของ Supabase | พอร์ต | ใช้กับ |
|---|---|---|
| Direct connection | 5432 ที่ `db.<ref>.supabase.co` | **IPv6 เท่านั้น** (IPv4 = add-on เสียเงิน) · migration / pg_dump จากเครื่องที่มี IPv6 |
| Session pooler (Supavisor) | 5432 ที่ `aws-0-ap-southeast-1.pooler.supabase.com` | IPv4 ได้ · พฤติกรรมเหมือนต่อตรง (1 client = 1 backend ตลอด session) · **migration และ pg-check ใช้ทางนี้** |
| Transaction pooler | 6543 | 1 backend ต่อ 1 ทรานแซกชัน · เหมาะกับ container หลายตัว · ไม่มี session state |

โค้ดของเราใช้ได้กับ transaction pooler เพราะ
- สิทธิ์และบริษัทตั้งด้วย `SET LOCAL ROLE` + `set_config(…, true)` **ภายในทรานแซกชันเดียวกับงาน** (Buddy `runInCompanyScope` · POS/Living `withTenant`) — จบทรานแซกชันค่าหาย ไม่รั่วไปคำขออื่น (pg-check ตรวจ: ตั้งในทรานแซกชัน → อ่านได้ · หลัง COMMIT → ว่าง แม้ backend เปลี่ยน)
- `pg` (node-postgres) ใช้ unnamed prepared statement → ใช้ได้กับ pooler โหมด transaction
- migration เป็นสคริปต์เดียว `BEGIN … COMMIT` ในคำสั่งเดียว
- **ข้อควรระวัง:** POS/Living ตั้งเขตเวลาด้วยตัวเลือกตอนเชื่อมต่อ `options=-c TimeZone=Asia/Bangkok` — pooler อาจละเว้น (pg-check รายงาน "ตัวเลือก TimeZone ตอนเชื่อมต่อ") · งานในนามผู้ใช้ตั้ง TimeZone ใน withTenant อยู่แล้ว แต่งานระบบ (db.tx) อาศัยตัวเลือกนี้ → ตั้งค่าที่ฐานแทน: `ALTER DATABASE postgres SET timezone TO 'Asia/Bangkok';` ในโปรเจกต์ POS และ Living (ทำครั้งเดียว · ➕ S1)
- ขนาด pool: `pg.Pool max 10` ต่อ container — Supavisor ของ Supabase ขนาดเล็กรับ client ได้ราว 200 · ถ้าใช้ session pooler ต้องคุม `max_instances × 10` ไม่เกิน pool size ของโปรเจกต์

## 6. งานเบื้องหลังเมื่อ container หลับ (scale to zero)

| โปรแกรม | งาน (setInterval ใน process) | ค่าตั้ง | ถ้าหลับ |
|---|---|---|---|
| WTS-POS | ส่งคิว outbox เข้า Buddy | `WTSPOS_OUTBOX_EVERY` 30 วิ | เอกสารค้างจนตื่น (ไม่หาย ไม่ซ้ำ — D11) |
| | ดึงฟีดข้อมูลหลักจาก Buddy | `WTSPOS_FEED_EVERY` 120 วิ | ราคา/สินค้าใหม่ช้า |
| | **ร้านออนไลน์: ตัดบัตรสมาชิก Opn รายสัปดาห์ · อ่านสถานะบัตรที่ค้าง · เตือน · ส่ง LINE/อีเมลในคิว** | `WTSPOS_SHOP_EVERY` 60 วิ | **ตัดเงินช้า/เตือนไม่ทัน** |
| | รายงานสถานะคิวให้ Hub | `WTSPOS_STATUS_EVERY` 120 วิ | Hub เห็นสถานะเก่า |
| WTS-Living | ส่งคิว outbox · ดึงฟีด · รายงาน Hub | `WTSLIVING_*_EVERY` | เหมือน POS |
| Buddy | ซิงก์เครื่องสาขาออฟไลน์ (`BUDDY_SYNC_SECONDS`) — ทำงานที่เครื่องสาขาเท่านั้น ไม่ใช่บนคลาวด์ · ล้างใบสมัครอายุ 90 วันทำตอนมีคำขอ | — | ไม่กระทบ |

ข้อเสนอ
1. **S1 (ง่าย ใช้ได้ทันที):** แต่ละโปรแกรม `max_instances = 1` · `sleepAfter = "30m"` · **Cron Trigger ทุก 5 นาที** เรียก `/api/health` ของ container → container ตื่น/ไม่หลับ งาน setInterval ทำงานตามเดิม (ค่าใช้จ่ายเท่าเปิดตลอดเวลาทำการ) · ร้านที่ใช้ร้านออนไลน์: ตั้ง cron ถี่ขึ้นหรือไม่ให้หลับ (= "min instances 1")
2. **S2 (ประหยัด + หลายเครื่อง):** ➕ `POST /internal/tick` (กุญแจลับใน header จาก Worker) ทำงานแต่ละอย่าง 1 รอบแล้วตอบ · ➕ `pg_try_advisory_lock` ต่องาน + ต่อ migration ตอนเปิดโปรแกรม เพื่อให้หลาย container ไม่ทำซ้ำ (outbox ส่งซ้ำไม่ลงซ้ำอยู่แล้วด้วย X-Source-Ref แต่การตัดบัตร Opn ต้องมีเครื่องเดียว) · Cron Trigger เรียก tick แทน health · container หลับได้ระหว่างรอบ

## 7. ความลับ

- ไม่อยู่ใน image / git / log: `DATABASE_URL` · `BUDDY_SECRET_KEY` / `WTSPOS_SECRET_KEY` / `WTSLIVING_SECRET_KEY` (กุญแจหลัก 32 ไบต์ base64 ที่เข้ารหัส 2FA กุญแจ API กุญแจ Buddy/LINE/Opn เลขบัตร) · `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` · กุญแจ Opn / Resend / LINE ของร้าน (อยู่ในฐานแบบเข้ารหัสอยู่แล้ว)
- ตั้งด้วย `npx wrangler secret put <ชื่อ>` (พิมพ์ค่าในหน้าต่างของเจ้าของเอง) → Worker ส่งเข้า container ทาง `envVars`
- **กุญแจหลักต้องคงที่และสำรองไว้** (ตัวจัดการรหัสผ่าน) — ถ้าไม่ตั้ง โปรแกรมสร้างไฟล์ `.data/secret.key` ใน container ซึ่งหายเมื่อ container หยุด → ข้อมูลที่เข้ารหัสเปิดไม่ได้ · ย้ายข้อมูลจากเครื่องนี้ = ใช้ค่าเดิมจาก `.data/secret.key`
- รหัสผ่านฐานข้อมูล Supabase: ตัวอักษร+ตัวเลข ≥ 24 ตัว เปลี่ยนตามรอบ (Project Settings › Database) แล้ว `wrangler secret put DATABASE_URL` ใหม่ · R2 token แยกต่อ bucket สิทธิ์ Object Read & Write เท่านั้น
- เครื่องนี้: `.data/cloud-s0.env` (ไม่เข้า git — `.data/` อยู่ใน .gitignore ทั้ง 3 repo) · pg-check ปิดบังค่าทุกบรรทัด

## 8. สำรองข้อมูล / PITR / ภูมิภาค / PDPA

- **สำรอง:** Supabase แผน Pro สำรองรายวันเก็บ 7 วัน · **PITR** (กู้ย้อนเวลาเป็นวินาที) เป็น add-on แยกราคา — เปิดสำหรับ Buddy (บัญชี) เป็นอย่างน้อย · ➕ สำรองของเราเอง: `pg_dump` รายสัปดาห์ขึ้น R2 bucket แยก (เข้ารหัส, เก็บ 90 วัน) + ทดสอบกู้คืนเดือนละครั้งลงโปรเจกต์ทดสอบ · ลูกค้าดาวน์โหลดข้อมูลตัวเองได้ (`.buddy-tenant`, docs/11)
- R2 ไม่มี versioning — ไฟล์ที่ลบแล้วกู้ไม่ได้ · โปรแกรมลบไฟล์เมื่อแทน/ลบรูปเท่านั้น · ➕ รวมไฟล์ R2 ในสำรองรายสัปดาห์ (S1)
- **ภูมิภาค:** Supabase = Southeast Asia (Singapore) `ap-southeast-1` · R2 = location hint APAC (เป็นคำแนะนำ ไม่ใช่การรับประกันประเทศ) · Containers รันที่ศูนย์ของ Cloudflare ใกล้ผู้ใช้
- **PDPA:** ข้อมูลอยู่นอกประเทศไทย = การโอนข้อมูลไปต่างประเทศ (ม. 28–29) → ต้องมีมาตรการคุ้มครองที่เพียงพอ: ลงนาม DPA ของ Supabase และ Cloudflare · ระบุใน DPA/นโยบายความเป็นส่วนตัวของ WTS ว่าเก็บที่สิงคโปร์ · บันทึกในทะเบียน (docs/10) · แจ้งเหตุรั่วไหลภายใน 72 ชม. · ลบข้อมูลลูกค้าที่เลิกใช้ 90 วัน (มีแล้ว) — **ให้ทนายตรวจก่อน S2**

## 9. ไฟล์ของผู้ใช้ และที่เก็บไฟล์ R2

### ไฟล์ที่เก็บอยู่ตอนนี้ (ทั้งหมดอยู่ในฐานข้อมูล)
| โปรแกรม | ไฟล์ | ที่เก็บ | ขนาดสูงสุด | ไป R2 เมื่อ `FILES_DRIVER=r2` |
|---|---|---|---|---|
| Buddy | โลโก้ / ลายเซ็นบริษัท | `sys_company_image.data` (base64 text) | 300 KB · PNG/JPEG | ✅ `logo` `sign` |
| Buddy | รูปสินค้า (≤ 8 รูป/รหัส) + รูปย่อ | `md_item_image.data` + `thumb` | 300 KB + รูปย่อ 40 KB | ✅ รูปเต็ม `item-image` · รูปย่ออยู่ในฐาน |
| Buddy | บิลที่ให้ AI อ่าน · แฟ้มนำเข้าเงินเดือน/Excel | ไม่เก็บ (อ่านแล้วทิ้ง) | 10 MB | — |
| Buddy | แฟ้มนำเข้า Express (.DBF) | โฟลเดอร์ชั่วคราวของเครื่อง + งานในหน่วยความจำ | — | — (ต้อง 1 เครื่อง ข้อ 1) |
| WTS-POS | รูปเมนู / รูปสินค้า-วัตถุดิบ | `pos.item_images.data` (bytea) | 1 MB · JPEG/PNG/WebP | ✅ `menu-image` `stock-image` (หน้าลูกค้าเปิดรูปผ่าน POS — ไม่เปิด bucket) |
| WTS-POS | สลิปร้านออนไลน์ | `pos.shop_slips.data` (bytea) | 2 MB | ✅ `slip` · พนักงานเปิดผ่านที่อยู่แบบเซ็น 5 นาที |
| WTS-POS | โลโก้หัวกระดาษ / ลายเซ็นในแบบพิมพ์ | `core.companies.print_logo` / `pos.print_signatures` (data URL) | 100 KB / ~300 KB | อยู่ในฐาน (เล็ก ใช้ตอนพิมพ์ — ย้ายใน S1 ถ้าจำเป็น) |
| WTS-Living | โลโก้บริษัท (PDF) | `core.company_logos.data` (bytea) | 512 KB | ✅ `logo` |
| WTS-Living | รูปมิเตอร์ · สลิปจากหน้าผู้อยู่อาศัย | `living.files.data` + `thumb` | 300 KB + รูปย่อ 60 KB · เก็บรูปเต็มตามอายุ (ค่าเริ่มต้น 24 เดือน) | ✅ รูปเต็ม `meter-photo` `slip` · พ้นอายุ = ลบใน R2 ด้วย |
| WTS-Living | ลายเซ็นในแบบพิมพ์ | `living.print_signatures.image` (data URL) | ~300 KB | อยู่ในฐาน |

หน้าจอย่อ/บีบอัดรูปก่อนส่งเหมือนเดิม (ไม่เปลี่ยน) · ขนาดสูงสุดเท่าเดิม

### ตัวเก็บไฟล์ (เหมือนกันทั้ง 3 repo: `apps/server/src/storage/`)
- `sigv4.ts` — AWS Signature V4 ด้วย `node:crypto` (ไม่มี AWS SDK ไม่มีแพ็กเกจใหม่) · ทดสอบกับชุดตัวอย่างของ AWS: get-vanilla, query-order, S3 GET (Range), S3 PUT, S3 presigned URL
- `files.ts` — `FileStore { put, get, delete, signedUrl }` · `local` (ค่าเริ่มต้น = พฤติกรรมเดิม: ไฟล์ของหน้าจอเดิมอยู่ในแถวฐานข้อมูล; ตัวเก็บแบบโฟลเดอร์ `.data/files` สำหรับไฟล์ที่ระบุด้วย key) · `r2` (S3 API ของ R2 ผ่าน `fetch`, region `auto`)
- key = `<company_id>/<kind>/<uuid>.<ext>` · `scopedStore(store, companyId)` ปฏิเสธ key ของบริษัทอื่น · ทุกการอ่านผ่าน API ที่ตรวจบริษัทของ session (RLS + key) ก่อน แล้วจึงส่งต่อไปที่อยู่แบบเซ็นอายุ 300 วินาที (Buddy รูปสินค้า, POS สลิป, Living รูปมิเตอร์/สลิป) หรือโปรแกรมอ่านแล้วส่งเอง (โลโก้/ลายเซ็นที่ใช้พิมพ์, รูปเมนูของหน้าลูกค้า)
- ค่าตั้ง: `FILES_DRIVER=r2` · `R2_ACCOUNT_ID` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_PUBLIC_BASE_URL` (ไม่บังคับ ไม่ใช้กับไฟล์ส่วนตัว) — ไม่พิมพ์ค่าลง log
- ไฟล์เดิมในฐานใช้ต่อได้ (อ่านที่เดิม · บันทึกใหม่ไปที่ใหม่) · ย้ายเองได้ (ไม่บังคับ): Buddy `pnpm --filter @buddy/server cli files-migrate` · POS/Living `pnpm --filter @wtspos/server exec tsx src/cli.ts files-migrate` (`@wtsliving/server`) — ไม่ใส่ `--apply` = ทดลองนับ ไม่เปลี่ยนอะไร
- schema: Buddy `0062_file_storage_key.sql` (spec.py) · POS `0043_file_storage.sql` · Living `0018_file_storage.sql` — `storage_key` + ช่อง data ว่าง/null ได้เมื่อมี key
- ทดสอบ (ไม่มีเครือข่ายจริง): `test/storage.test.ts` (SigV4 + r2 กับ fetch จำลอง + local + ปฏิเสธ key บริษัทอื่น) ทุก repo · Buddy `storage-endpoints.test.ts` · POS/Living `storage-r2.test.ts` (อัปโหลด → R2, อ่านด้วยที่อยู่แบบเซ็น, บริษัทอื่น 404, files-migrate)
- ยังไม่ทำ (➕ S1/S5): ส่งออก/ลบไฟล์ R2 พร้อมลูกค้า (`.buddy-tenant`, ลบตาม PDPA — key แยกตามบริษัทแล้ว ใช้ ListObjectsV2 ตาม prefix) · แฟ้มสำรอง/ซิงก์สาขาของ Buddy มีแค่ key ของรูปที่อยู่ใน R2 · ลายเซ็น/โลโก้แบบพิมพ์ของ POS/Living

### ค่าใช้จ่าย (ลูกค้า ≤ 30 ราย · ~75 MB/ราย/เดือน = ~2.25 GB/เดือน · ~27 GB ปีแรก)
R2: ฟรี 10 GB-เดือน แล้วราว $0.015/GB-เดือน · ไม่มีค่าโอนออก · คำสั่งฟรี 1 ล้าน (เขียน) / 10 ล้าน (อ่าน) ต่อเดือน → ปลายปีแรก ~17 GB ที่เสียเงิน ≈ $0.26/เดือน · Cloudflare อาจให้ผูกบัตรก่อนเปิด R2
(ถ้าเก็บในฐาน Supabase: เกินโควตาฐานของแผน Pro ภายในปีแรก และทำให้สำรอง/PITR ใหญ่และช้า)

### ขั้นตอนของเจ้าของ (รายละเอียดใน `tools/cloud/README.md` ข้อ 2)
1. R2 › Create bucket `wts-s0-test` · Location hint **Asia-Pacific (APAC)** · ห้ามเปิด public / r2.dev
2. R2 API token: **Object Read & Write · เฉพาะ bucket นั้น**
3. ใส่ `R2_*` ใน `E:\BuddyAccount\.data\cloud-s0.env` (ไม่ใช่ในแชท) → `node tools\cloud\pg-check.mjs --r2-only`
4. Lifecycle rules: ลบ object อายุ 1 วันใน prefix ไฟล์ชั่วคราว (`*/s0-check/`, `*/tmp/`) · ยกเลิก multipart ที่ค้าง 1 วัน
5. ใช้งานจริง: bucket ต่อโปรแกรม (`wts-buddy-files` `wts-pos-files` `wts-living-files`) + token ต่อ bucket

## 10. มีแล้ว / ต้องทำ

| เรื่อง | มีแล้ว | ต้องทำ (ขั้น) |
|---|---|---|
| โปรแกรมรันกับ PostgreSQL 16 / Supabase | ✅ ทั้ง 3 repo (S0) · ชุดทดสอบรับมอบบนฐานจริง | รันกับ Supabase จริง (S0 เจ้าของ) |
| RLS + role | ✅ + แก้ PG16 (0061) | — |
| Container image | ✅ Dockerfile + Actions | worker + wrangler + โดเมน (S1) |
| งานเบื้องหลัง | ✅ setInterval | cron ปลุก (S1) · `/internal/tick` + advisory lock (S2) · migration lock (S2) |
| ความลับ | ✅ อ่านจาก env, เข้ารหัสในฐาน | ตั้ง wrangler secret (S1) |
| ไฟล์ | ✅ local/r2 + migrate | bucket (เจ้าของ) · ส่งออก/ลบพร้อมลูกค้า (S5) |
| สำรอง | ✅ Supabase รายวัน · .buddy-tenant | PITR (เจ้าของ) · pg_dump→R2 + ทดสอบกู้ (S1) |
| Cloudflare WAF/Turnstile | ✅ กันซ้ำในโปรแกรม | กฎ WAF (S1) · Turnstile (S2) |
| สมัคร / แพ็กเกจ / ชำระเงิน | ✅ signup + โควตา + ระงับ | ยืนยันอีเมล · บริษัทแรกอัตโนมัติ (S2) · Opn รายเดือน + อ่านอย่างเดียวเมื่อค้าง (S3) |
| เปิดโปรแกรมเองใน Hub · WTS-SOP SSO | ✅ tenant_modules · SSO POS/Living | เปิดเอง + ตั้งค่าอัตโนมัติ (S4) |
| เจ้าหน้าที่เข้าดูข้อมูลลูกค้า · ฐานแยกลูกค้าใหญ่ · ซิงก์เครื่องลูกค้า | ✅ ย้ายลูกค้า (docs/11) | หน้าอนุญาต + บันทึก (S5) · T7.8 (S5) |

## 11. แผน S0–S5 สำหรับโค้ดชุดนี้

| ขั้น | งาน | เสร็จเมื่อ |
|---|---|---|
| **S0** | pg-check + ชุดทดสอบบนฐานจริง + Dockerfile/Actions + R2 + เอกสารนี้ | ✅ ซ้อมในเครื่องผ่าน · ✅ **Supabase จริงผ่าน (07/11/2569)** · ⏳ R2 bucket จริง · Transaction pooler · Actions เขียวทั้ง 3 repo |
| S1 | worker + wrangler ต่อ repo · ความลับ · โดเมน · cron ปลุก · `ALTER DATABASE … timezone` · ปิด Data API · ย้าย DEMO + WTS Prep (`.buddy-tenant` / pg_dump) · pg_dump→R2 + ทดสอบกู้ · ตรวจระบบ (health + แจ้งเตือน) | เปิด 24 ชม. ไม่ต้องเปิดเครื่องนี้ · ยอด DEMO เท่าเดิม (งบทดลอง 23,313,035.92) |
| S2 | Turnstile + ยืนยันอีเมล (Resend) + บริษัทแรก/ผังบัญชีอัตโนมัติ + ทดลองใช้ 30 วัน · `/internal/tick` + advisory lock | ลูกค้าสมัครเองได้ |
| S3 | แพ็กเกจ ราคา ตัดบัตร Opn รายเดือน (CardGateway ของ POS) · ค้างชำระ = อ่านอย่างเดียว | เก็บเงินอัตโนมัติ |
| S4 | เพิ่มโปรแกรมเองใน Hub (เปิดโมดูล + กุญแจ API + ตั้งค่าบัญชีอัตโนมัติ) · WTS-SOP รับ SSO (B6.3) | ลูกค้าต่อยอดเอง |
| S5 | หน้าเจ้าหน้าที่ (ลูกค้าอนุญาต มีเวลาหมด บันทึก) · ฐานแยกลูกค้าใหญ่ (docs/11 + R2 prefix) · ซิงก์จากเครื่องลูกค้า (T7.8) · ส่งออก/ลบไฟล์ R2 พร้อมลูกค้า | รองรับลูกค้าทุกขนาด |

## 12. ผลซ้อม S0 บนเครื่องนี้

- `node tools/cloud/pg-check.mjs --local-pg` (PostgreSQL 16.14 ของ Buddy พอร์ต 5544 · ฐานชั่วคราว `s0chk_*` ลบแล้ว · role ที่สร้างระหว่างซ้อมลบแล้ว · ไม่แตะ DEMO / `buddy_backup_*`): ประตูความปลอดภัยปฏิเสธฐานที่มีตารางระบบอื่น ✓ · migration Buddy 62/62 POS 43/43 Living 18/18 · ชุดทดสอบ 6+3 / 6 / 2+6 ข้อผ่าน · RLS ✓ ทั้ง 3 role · R2 จำลอง put/get/presign/ปฏิเสธไม่เซ็น/delete ✓
- `--sim-supabase` (ผู้เชื่อมต่อไม่ใช่ superuser + schema auth/storage): ผลเท่ากัน · schema ของแพลตฟอร์มยังอยู่หลังล้างข้อมูล · ก่อนมี 0061 Buddy ล้ม 9/9 ข้อ ("SET ROLE ✗")
- บูตแบบ container (`node node_modules/tsx/dist/cli.mjs src/main.ts` + ตัวแปรของ Dockerfile) กับฐานชั่วคราว: Buddy / POS / Living ตอบ health และหน้าเว็บ
- รายงาน: `.data/cloud-s0-report-local-pg.md`, `.data/cloud-s0-report-sim-supabase.md` (ไม่เข้า git)
