# เครื่องมือคลาวด์ (S0 ของ docs/20 — WTS Cloud SaaS)

ไฟล์ในโฟลเดอร์นี้
| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `pg-check.mjs` | ตรวจ PostgreSQL บนคลาวด์ (Supabase) ของ Buddy · WTS-POS · WTS-Living + ที่เก็บไฟล์ R2 แล้วเขียนสรุป `.data/cloud-s0-report.md` |
| `r2-check.ts` | ส่วนตรวจ R2 (pg-check เรียกเอง) |
| `set-supabase-url.ps1` | ใส่ที่อยู่ Supabase ลง `.data/cloud-s0.env` ให้ (เจ้าของไม่ต้องแก้ไฟล์เอง) |
| `cloud-s0.env.example` | แบบไฟล์ค่าตั้ง — คัดลอกเป็น `.data/cloud-s0.env` แล้วกรอกเอง (ไม่เข้า git) |

แผนทั้งหมด ข้อควรระวัง และสิ่งที่ยังต้องทำ: `docs/20_WTS Cloud SaaS.md`

## 1. ตรวจ Supabase (เจ้าของทำ ครั้งเดียว)

**แบบที่เจ้าของเลือก (07/11/2569): 1 โปรเจกต์ 3 ฐาน** — เครื่องมือสร้างฐาน `s0_buddy` `s0_wtspos` `s0_wtsliving` ในโปรเจกต์เดียวให้เอง (แบบ 1 โปรเจกต์ต่อโปรแกรมยังใช้ได้: ใส่ `BUDDY_/WTSPOS_/WTSLIVING_DATABASE_URL` แทน)

1. สร้างโปรเจกต์ Supabase **ใหม่ 1 โปรเจกต์** ชื่อเช่น `wts-cloud-test` — Region **Southeast Asia (Singapore)** · ตั้ง Database Password เป็นตัวอักษร+ตัวเลขยาว ≥ 24 ตัว (ไม่มี @ : / ? # %) จดไว้ในตัวจัดการรหัสผ่าน **ห้ามใช้โปรเจกต์ของ WTS-SOP** (เครื่องมือปฏิเสธโปรเจกต์ที่มีตารางอยู่แล้ว)
2. ปุ่ม **Connect** › **Session pooler** › คัดลอก URI (ลงท้าย `/postgres`)
3. (แนะนำ) แถบไอคอนซ้าย **Database** (รูปถังข้อมูล) › **Settings** › **SSL Configuration** › **Download certificate** → บันทึกเป็น `E:\BuddyAccount\.data\supabase-ca.crt` (หน้า Project Settings ของ Supabase รุ่นใหม่ไม่มีหัวข้อ Database แล้ว)
   - หาไม่เจอ/ข้าม: ต่อท้าย URL ด้วย `?sslmode=no-verify` แทน (ยังเข้ารหัส แต่ไม่ตรวจตัวตนเซิร์ฟเวอร์ — ใช้ทดสอบเท่านั้น) · **อย่าใช้ `sslmode=require`**: ไดรเวอร์ pg ของเราถือเป็น verify-full แล้วล้มด้วย "self-signed certificate" เพราะใบรับรองของ Supabase ไม่ได้ออกโดย CA สาธารณะ
4. **ง่ายสุด:** `powershell -ExecutionPolicy Bypass -File tools\cloud\set-supabase-url.ps1` — วาง URI, พิมพ์รหัสผ่าน (ไม่ขึ้นจอ) ตัวช่วยเขียนบรรทัด `SUPABASE_PROJECT_URL=` ให้เอง (ใส่รหัสแทน `[YOUR-PASSWORD]` · ต่อท้าย SSL ตามว่ามี `.data\supabase-ca.crt` หรือไม่) · หรือทำเอง: คัดลอก `tools\cloud\cloud-s0.env.example` เป็น `E:\BuddyAccount\.data\cloud-s0.env` (Notepad) แล้ววาง URI ที่บรรทัด `SUPABASE_PROJECT_URL=` ใส่รหัสผ่านแทน `[YOUR-PASSWORD]` และต่อท้ายด้วย `?sslmode=verify-full&sslrootcert=E:/BuddyAccount/.data/supabase-ca.crt` — **ห้ามวางรหัสผ่านในแชท**
5. (ไม่บังคับ) ใส่ **Transaction pooler** (พอร์ต 6543) ที่ `SUPABASE_POOLER_URL`
   - เครื่องมือเปลี่ยนเฉพาะชื่อฐานท้าย URL (`/postgres` → `/s0_buddy` …) แล้วตรวจว่าได้ฐานนั้นจริง · ถ้าแจ้งว่า pooler เลือกฐานไม่ได้ ให้ใช้ **Direct connection** แทน (ต้องมี IPv6 หรือซื้อ IPv4 add-on ของ Supabase)
   - ข้อดีเพิ่ม: Data API ของ Supabase ให้บริการเฉพาะฐาน `postgres` — ฐาน `s0_*` จึงไม่ถูกเปิดผ่านกุญแจ anon (ยังควรปิด Data API ไว้)
6. รันใน PowerShell:
   ```powershell
   cd E:\BuddyAccount
   node tools\cloud\pg-check.mjs --i-created-this-test-project
   ```
   ครั้งต่อไปไม่ต้องใส่ `--i-created-this-test-project` (เครื่องมือสร้างเครื่องหมาย `wts_s0_check.marker` ในฐานแล้ว)
7. ส่งข้อความกลับมาว่า "รัน pg-check แล้ว" — ผู้ช่วยอ่าน `.data\cloud-s0-report.md` เอง (ไม่มีรหัสผ่านในรายงาน)

ความปลอดภัยของเครื่องมือ
- อ่าน connection string จาก `.data/cloud-s0.env` เท่านั้น · ปิดบัง URL รหัสผ่าน ชื่อเครื่อง รหัสโปรเจกต์ในทุกบรรทัด (รวมผลของชุดทดสอบ)
- **ไม่ยอมรัน** ถ้าฐานมี schema/ตารางของระบบอื่น (นับเฉพาะ schema ของ Supabase เองเป็นของระบบ: auth storage realtime extensions …) หรือมีเครื่องหมายของโปรแกรมอื่น · pooler ต้องชี้ฐานเดียวกับ URL หลัก
- รอบที่ 2 ขึ้นไป: ล้างเฉพาะสิ่งที่สร้างหลังเครื่องหมาย (schema/ตารางของโปรแกรม) แล้วรันใหม่ทั้งหมด · role (`buddy_app` ฯลฯ) คงไว้

ทำอะไรบ้าง: รุ่น PostgreSQL / extension / SSL · สิทธิ์ CREATE ROLE / CREATE DATABASE (ลองจริงแล้วลบ) · กับดัก PostgreSQL 16+ (สร้าง role แล้ว SET ROLE ไม่ได้) · migration ของ 3 โปรแกรม · ชุดทดสอบรับมอบของแต่ละ repo บนฐานจริง (Buddy WTS Connect + ใบสำคัญ/งบทดลอง/RLS · POS B2.9 ยอดวัน · Living B5.2 บิล+ใบเสร็จ และ B5.3) · พิสูจน์ RLS ด้วย role ของแต่ละโปรแกรม · ตรวจ transaction pooler (SET LOCAL ไม่รั่ว ฯลฯ) · R2 put/get/ที่อยู่แบบเซ็น/delete

ซ้อมในเครื่องนี้ (ไม่ต้องมี Supabase):
```powershell
node tools\cloud\pg-check.mjs --local-pg       # PostgreSQL 16 ของ Buddy (พอร์ต 5544) ฐานชั่วคราว s0chk_* ลบเมื่อจบ — ไม่แตะ DEMO
node tools\cloud\pg-check.mjs --sim-supabase   # PostgreSQL ชั่วคราวพอร์ต 5549 ผู้เชื่อมต่อไม่ใช่ superuser แบบ Supabase
node tools\cloud\pg-check.mjs --sim-supabase --one-project   # แบบเดียวกัน แต่ 1 โปรเจกต์ 3 ฐาน (postgres สร้างฐานเองผ่าน URL เดียว)
node tools\cloud\pg-check.mjs --r2-only        # ตรวจเฉพาะ R2 จากค่าใน .data\cloud-s0.env
```
WTS-POS / WTS-Living มี `tools/cloud/pg-check.mjs` ที่ส่งต่อมาที่นี่ (`--apps pos` / `--apps living`)

## 2. ที่เก็บไฟล์ Cloudflare R2 (เจ้าของทำ)

1. Cloudflare dashboard › **R2 Object Storage** › (ครั้งแรกอาจต้องผูกบัตร — ฟรี 10 GB/เดือน เกินคิดราว $0.015/GB-เดือน ไม่มีค่าโอนออก)
2. **Create bucket**: ชื่อ `wts-s0-test` (ทดสอบ) · Location: **Provide a location hint › Asia-Pacific (APAC)** · ห้ามเปิด Public access / r2.dev
3. R2 › **Manage R2 API Tokens** › Create API token: Permissions **Object Read & Write** · **Apply to specific buckets only** › เลือก `wts-s0-test` · TTL ตามต้องการ → คัดลอก Access Key ID / Secret Access Key (แสดงครั้งเดียว) และ Account ID
4. ใส่ใน `.data\cloud-s0.env` (`R2_ACCOUNT_ID` `R2_BUCKET` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY`) แล้ว `node tools\cloud\pg-check.mjs --r2-only`
5. bucket จริงตอนใช้งาน: 1 bucket ต่อโปรแกรม (`wts-buddy-files` `wts-pos-files` `wts-living-files`) token แยกต่อ bucket · Object lifecycle rules: ตั้ง "Delete objects" อายุ 1 วันสำหรับ prefix ที่เป็นไฟล์ชั่วคราว (เช่น `*/s0-check/`, `*/tmp/`) และ "Abort incomplete multipart uploads" 1 วัน

โปรแกรมเปิดใช้ R2 ด้วยตัวแปร: `FILES_DRIVER=r2` `R2_ACCOUNT_ID` `R2_BUCKET` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` (ไม่ตั้ง = `local` เก็บในฐานข้อมูลเหมือนเดิม) · ย้ายรูปเดิมขึ้น R2 (ไม่บังคับ): `pnpm --filter @buddy/server cli files-migrate` (ทดลอง) แล้วใส่ `--apply`

## 3. ขึ้น Cloudflare Containers (แบบร่างเดิม — ใช้ข้อ 6 แทน: Container class เดิมเปลี่ยนเป็น Durable Object Container API)

ต้องมี: Workers Paid ($5/เดือน) · Docker บนเครื่องที่ deploy (หรือให้ GitHub Actions ทำ) · `npx wrangler login`
image สร้างจาก `Dockerfile` ที่ราก repo (GitHub Actions `container` สร้างทุกครั้งที่ push — ดูผลที่ github.com › repo › **Actions**)

`tools/cloud/worker/wrangler.jsonc` (ตัวอย่าง — ตรวจกับเอกสาร Cloudflare Containers รุ่นล่าสุดตอน deploy):
```jsonc
{
  "name": "buddy-account",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "containers": [{ "class_name": "BuddyApp", "image": "../../../Dockerfile", "instance_type": "standard", "max_instances": 1 }],
  "durable_objects": { "bindings": [{ "class_name": "BuddyApp", "name": "APP" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BuddyApp"] }],
  "triggers": { "crons": ["*/5 * * * *"] }
}
```
`tools/cloud/worker/src/index.ts` (แพ็กเกจ `@cloudflare/containers` ติดตั้งในโฟลเดอร์ worker ตอน deploy เท่านั้น):
```ts
import { Container, getContainer } from '@cloudflare/containers';
export class BuddyApp extends Container<Env> {
  defaultPort = 4100;
  sleepAfter = '30m';
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = { DATABASE_URL: env.DATABASE_URL, BUDDY_SECRET_KEY: env.BUDDY_SECRET_KEY, BUDDY_COOKIE_SECURE: '1', BUDDY_PUBLIC_URL: env.BUDDY_PUBLIC_URL,
      FILES_DRIVER: 'r2', R2_ACCOUNT_ID: env.R2_ACCOUNT_ID, R2_BUCKET: env.R2_BUCKET, R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY };
  }
}
export default {
  fetch: (req: Request, env: Env) => getContainer(env.APP).fetch(req),
  // ปลุก container ทุก 5 นาที ให้งานเบื้องหลังได้ทำงาน (Buddy: ซิงก์สาขา · POS/Living: ส่งคิว outbox ดึงฟีด ตัดบัตร Opn)
  scheduled: async (_e: ScheduledEvent, env: Env) => { await getContainer(env.APP).fetch(new Request('http://app/api/v1/health')); },
};
```
ความลับ (พิมพ์ในหน้าต่าง PowerShell ของตัวเอง — ค่าไม่ขึ้นจอ ไม่เข้า git):
```powershell
cd E:\BuddyAccount\tools\cloud\worker
npx wrangler secret put DATABASE_URL         # Transaction pooler 6543 หรือ Session pooler 5432 ของโปรเจกต์ Buddy
npx wrangler secret put BUDDY_SECRET_KEY     # กุญแจหลัก 32 ไบต์ base64 — ค่าเดียวกับ .data\secret.key ถ้าย้ายข้อมูลจากเครื่องนี้
npx wrangler secret put R2_ACCESS_KEY_ID ; npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler deploy
```
โดเมน `app.worktruesolution.net` → Workers › buddy-account › Settings › Domains & Routes · WAF/Rate limiting/Turnstile ตั้งที่โซนของโดเมน (docs/20 ข้อ 2)

## 4. ตั้งฐานใช้งานจริง wts-prod (ขั้น S1 — เจ้าของรันเอง)

โปรเจกต์ Supabase **wts-prod** (องค์กร WTS Production แผน Pro · Singapore · Data API ปิด) — 1 โปรเจกต์ 4 ฐาน: `buddy` `wtspos` `wtsliving` `wtshr` (WTS-HR ย้ายมาใช้ตอน S4)

1. บันทึกที่อยู่ (ครั้งเดียว): `powershell -ExecutionPolicy Bypass -File tools\cloud\set-supabase-url.ps1 -EnvFile .data\cloud-prod.env`
2. ตรวจอย่างเดียว (ไม่เปลี่ยนอะไร): `node tools\cloud\prod-setup.mjs --check`
3. ตั้งค่า (เจ้าของรันเองในหน้าต่าง PowerShell — ระบบอนุญาตของผู้ช่วยไม่ให้เขียนฐานใช้งานจริง): `node tools\cloud\prod-setup.mjs`
   - สร้างฐานที่ยังไม่มี (UTF8) · เขตเวลาฐาน Asia/Bangkok · migration ของ Buddy / WTS-POS / WTS-Living · ถอนสิทธิ์ anon/authenticated ทุก schema (ชั้นที่สองหลังปิด Data API) · ตรวจ role ใต้ RLS
   - รันซ้ำได้ (ทำเฉพาะที่ยังไม่ได้ทำ · ไม่ลบข้อมูล) · ผลอยู่ที่ `.data\cloud-prod-report.md` (ไม่มีรหัสผ่าน/ที่อยู่)
4. ซ้อมในเครื่องก่อนแก้เครื่องมือนี้: `node tools\local-pg\pg.mjs run -- node tools\cloud\prod-setup.mjs --rehearse` (ฐาน `rehearse_*` + role anon จำลอง ลบเมื่อจบ — ไม่แตะ DEMO)

**ห้ามใช้ `pg-check.mjs` กับ wts-prod** — pg-check เป็นเครื่องมือทดสอบ (สร้างฐาน s0_* และล้างข้อมูลระหว่างทดสอบ) และปฏิเสธโปรเจกต์ที่มีฐาน buddy/wtspos/wtsliving/wtshr หรือเครื่องหมาย `wts_prod` อยู่แล้ว

## 5. ที่เก็บไฟล์ R2 ใช้งานจริง (ขั้น S1 — เจ้าของทำ)

1 bucket + 1 กุญแจ ต่อโปรแกรม (โปรแกรมหนึ่งเปิดไฟล์ของอีกโปรแกรมไม่ได้): `wts-buddy-files` · `wts-pos-files` · `wts-living-files` — Location hint **Asia-Pacific (APAC)** · ห้ามเปิด Public access / r2.dev
1. Cloudflare › R2 Object Storage › Create bucket ×3 (ชื่อตามข้างบน)
2. เปิดตัวช่วยไว้ก่อน: `powershell -ExecutionPolicy Bypass -File tools\cloud\set-r2-keys.ps1` (ค่าเริ่มต้น .data\cloud-prod.env)
3. R2 › Manage API tokens › Create Account API token: Permissions **Object Read & Write** · **Apply to specific buckets only** › bucket ของโปรแกรมนั้น · TTL Forever → วาง Access Key ID / Secret Access Key ในตัวช่วย (Secret ไม่ขึ้นจอ · แสดงครั้งเดียวที่ Cloudflare) · ทำทีละโปรแกรม
4. ตรวจ: `node tools\cloud\prod-setup.mjs --r2` (put → get → ที่อยู่แบบเซ็น → ไม่เซ็นต้องถูกปฏิเสธ → delete · ไฟล์ทดสอบชนิด s0-check ลบเองเมื่อจบ) · รายงาน `.data\cloud-prod-r2-report.md`

## 6. ขึ้น Cloudflare จริง (ขั้น S1 · 10/11/2569)

แต่ละ repo มี `wrangler.jsonc` ที่ราก + `cloud/worker.js` (เหมือนกันทั้ง 3 repo ต่างแค่ APP) — Worker ชื่อ `wts-buddy` · `wts-pos` · `wts-living`
- container จาก `Dockerfile` ที่ราก · instance `basic` (1/4 vCPU · 1 GiB) · `max_instances` 1 · Durable Object Container API (`this.ctx.container`) ไม่ต้องติดตั้งแพ็กเกจ
- Worker เขียน X-Forwarded-For/-Proto/-Host ใหม่ทุกคำขอ (ทิ้งค่าที่ผู้ใช้ส่งมา) → โปรแกรมเชื่อด้วย `BUDDY_TRUST_PROXY=1` / `WTSPOS_TRUST_PROXY=1` (Living เชื่ออยู่แล้ว)
- cron ทุก 5 นาทีปลุก container (งานเบื้องหลัง) · ไม่มีความลับ = ตอบ 503 บอกวิธีแก้ (ไม่เปิดด้วยฐานชั่วคราว)
- ใบรับรอง CA ของ Supabase (สาธารณะ) อยู่ที่ `tools/cloud/supabase-ca.crt` ของทุก repo → ใน image คือ `/app/tools/cloud/supabase-ca.crt`

**deploy = Workers Builds** (เครื่องนี้ไม่มี Docker — `wrangler deploy` ในเครื่องสร้าง image ไม่ได้): Cloudflare › Workers & Pages › Create › Import a repository › GitHub
› เลือก repo › ชื่อ Worker ต้องตรงกับ `name` ใน wrangler.jsonc › Build command ว่าง › Deploy command `npx wrangler deploy` › Root directory `/` — push เข้า main = deploy เอง

**ความลับ** (หลัง Worker ถูกสร้างครั้งแรก — เจ้าของรัน): `node tools\cloud\put-secrets.mjs` (ทั้ง 3) หรือ `--app buddy|pos|living` · ทดลอง `--dry-run`
- DATABASE_URL = ที่อยู่โปรเจกต์ wts-prod + ชื่อฐาน + `sslmode=verify-full&sslrootcert=/app/tools/cloud/supabase-ca.crt`
- กุญแจหลัก BUDDY_/WTSPOS_/WTSLIVING_SECRET_KEY สร้างครั้งแรกแล้วเก็บใน `.data/cloud-prod.env` — **สำรองไฟล์นี้** (หายแล้วถอดรหัสข้อมูลลับในฐานไม่ได้)

ตรวจในเครื่องได้เฉพาะตัว Worker: `npx wrangler@4 deploy --dry-run --containers-rollout=none --outdir %TEMP%\wr-dry`

## 7. เชื่อม POS + Living บนคลาวด์เข้ากับ Buddy (10/11/2569 · HANDOFF 107 — เจ้าของรัน)

ก่อนรัน: ตั้งค่าครั้งแรกของ WTS-POS และ WTS-Living บนคลาวด์แล้ว (มีบริษัทละ 1) · Access app `buddy-api` เป็น Bypass แล้ว

```
node tools\cloud\link-apps.mjs                  (บริษัท DEMO · --company <รหัส> = บริษัทอื่น)
node tools/local-pg/pg.mjs run -- node tools/cloud/link-apps.mjs --rehearse   (ซ้อมในเครื่อง ฐานชั่วคราว)
```
- Buddy: เปิดการ์ด POS/Living ให้ลูกค้าของบริษัท (ที่อยู่ pos.worktruesolution.net/office/ · living.worktruesolution.net/office/ — เดิม *.rongphai.workers.dev ยังเปิดได้) + กุญแจ API บันทึกได้ ผูกระบบ wts-pos / wts-living ในนามผู้ดูแลของลูกค้า (รันซ้ำ = ยกเลิกกุญแจรุ่นก่อน)
- POS/Living: ที่อยู่ Buddy = https://buddy-api.worktruesolution.net · กุญแจเข้ารหัสด้วยกุญแจหลักของโปรแกรม (tools/hub/link-buddy.mts ของแต่ละ repo) · ปลายทางบัญชี = Buddy
- ทดสอบ: JWKS + /api/v1/auth/me ด้วยกุญแจแต่ละดอกผ่าน buddy-api · ทดสอบสุดท้าย = กดการ์ดในหน้าเลือกโปรแกรม

## 8. สำรองข้อมูลคลาวด์ + ทดสอบกู้คืน (11/11/2569 · HANDOFF 112 — เจ้าของรัน)
```
สำรองข้อมูลคลาวด์.cmd          (ดับเบิลคลิก = สำรองเดี๋ยวนี้ · หรือ node tools\cloud\backup.mjs)
ตั้งสำรองอัตโนมัติ.cmd          (ดับเบิลคลิกครั้งเดียว = งานตามเวลา "WTS cloud backup" ทุกวัน 12:30 · เครื่องปิด = ทำเมื่อเปิดเครื่อง)
node tools\cloud\backup.mjs --verify [โฟลเดอร์]          (ทดสอบกู้คืนอย่างเดียว — ไม่ระบุ = ชุดล่าสุด)
node tools/local-pg/pg.mjs run -- node tools/cloud/backup.mjs --rehearse [--keep]   (ซ้อมกับ DEMO ในเครื่อง)
```
- ต้องมี PostgreSQL 17 (pg_dump/pg_restore/initdb/pg_ctl) ใน `.data\pg17\pgsql\bin` — แตกจาก `postgresql-17.11-1-windows-x64-binaries.zip` (get.enterprisedb.com · เฉพาะ bin lib share) · ฐานคลาวด์เป็นรุ่น 17 จึงใช้ PostgreSQL 16 ในเครื่องไม่ได้
- สำรอง 4 ฐาน buddy · wtspos · wtsliving · wtshr → `E:\WTS-Backup\cloud\<พ.ศ.-เดือน-วัน_เวลา>\<ฐาน>.dump` (pg_dump custom) + `manifest.json` (จำนวนแถวทุกตาราง + ยอดเดบิต/เครดิตของ Buddy นับใน snapshot เดียวกับไฟล์สำรอง · sha256)
- ทดสอบกู้คืนทุกครั้ง: PostgreSQL 17 ชั่วคราวในเครื่อง (พอร์ตว่าง · ไม่แตะฐานใช้งาน) → pg_restore → จำนวนแถวตรงทุกตาราง + เดบิต/เครดิตตรง → ปิดและลบ · ผลเก็บ `restore-check.json`
- เก็บ 30 วัน (ลบชุดเก่าเมื่อชุดใหม่ทดสอบผ่านเท่านั้น) · ประวัติ `E:\WTS-Backup\cloud\ประวัติการสำรอง.txt` · ผลรอบอัตโนมัติล่าสุด `last-run.log`
- Supabase Pro สำรองให้เองทุกวัน (7 วัน) อยู่แล้ว — ชุดนี้คือสำเนาที่สองนอก Supabase และพิสูจน์ว่ากู้ได้จริง · ไฟล์สำรองมีข้อมูลลูกค้าทั้งหมด: เก็บในเครื่องสำนักงาน ห้ามแชร์
- กู้คืนจริง (ฉุกเฉิน): ผู้ช่วยเตรียมขั้นตอนตามเหตุการณ์ — `pg_restore --clean --no-owner` เข้าฐานใหม่บน Supabase แล้วสลับ DATABASE_URL (อย่ากู้ทับฐานที่ใช้งานอยู่โดยไม่สำรองก่อน)

### 8.1 สำเนานอกเครื่อง (19/11/2569 · HANDOFF 146)

ชุดที่ทดสอบกู้คืนผ่านแล้วทุกวัน → **เข้ารหัสด้วยกุญแจของเจ้าของ** (`.data\backup-offsite.key` · AES-256-GCM) → ส่งไปที่เก็บที่สอง · เก็บ 90 วัน · อ่านกลับและถอดรหัสตรวจ sha256 ทุกไฟล์ · ผลอยู่ใน `last-run.log` และบรรทัดเดียวกันของ `ประวัติการสำรอง.txt` ("นอกเครื่อง: ✓ …" / "⚠ ยังไม่มีสำเนานอกเครื่อง") · สำเนานอกเครื่องไม่สำเร็จ = exit 2 (ชุดหลักยังสำเร็จ)

```
node tools/cloud/setup-offsite.mjs --status                         ดูค่าที่ตั้ง (ไม่แสดงกุญแจ)
node tools/cloud/setup-offsite.mjs --folder "<ไดรฟ์ภายนอก หรือโฟลเดอร์ OneDrive ที่เลือก>"   ตั้งโฟลเดอร์ที่สอง + สร้างกุญแจครั้งแรก + ทดสอบเขียน/อ่าน
node tools/cloud/setup-offsite.mjs --export-key "<ไดรฟ์ USB>"         คัดลอกกุญแจไปเก็บแยกจากเครื่องนี้
powershell -ExecutionPolicy Bypass -File tools\cloud\set-r2-keys.ps1   (ขั้น "สำรองนอกเครื่อง") กุญแจ R2 ของ bucket wts-backup-offsite
node tools/cloud/backup.mjs --offsite-fetch <โฟลเดอร์ชุด | r2:<ชุด>> [--offsite-key <ไฟล์กุญแจ>]   ถอดรหัสสำเนานอกเครื่องกลับ แล้วทดสอบกู้คืน
```

- ที่เก็บได้ 2 แบบ (ตั้งอย่างใดอย่างหนึ่งหรือทั้งสอง): **โฟลเดอร์ที่สอง** (`.data\backup-offsite.json` → `folder`) · **R2 bucket แยก** `wts-backup-offsite` (กุญแจ `BACKUP_R2_*` + `R2_ACCOUNT_ID` ใน `.data\cloud-prod.env` · token สิทธิ์ Object Read & Write เฉพาะ bucket นี้) — object `cloud-backup/<ชุด>/<ไฟล์>.enc`
- **กุญแจ = สิ่งเดียวที่เปิดสำเนานอกเครื่องได้**: เครื่องนี้เสียโดยไม่มีสำเนากุญแจ = สำเนานอกเครื่องใช้ไม่ได้ → คัดลอกกุญแจไปเก็บแยก (USB ในตู้เซฟ / ตัวจัดการรหัสผ่าน) · คนที่ได้ทั้งกุญแจและสำเนา = เปิดข้อมูลได้
- ซ้อม: `node tools/local-pg/pg.mjs run -- node tools/cloud/backup.mjs --rehearse --offsite-dir <โฟลเดอร์ทดลอง>` (กุญแจทดลองแยก) — ผ่าน 19/11/2569: ฐาน buddy ในเครื่อง 112 ตาราง 34,881 แถว เข้ารหัส → อ่านกลับตรง → `--offsite-fetch` ถอดรหัสกลับ → ทดสอบกู้คืนตรงทุกตาราง ยอดเดบิต = เครดิต
- ทดสอบ: `apps/server/test/offsite-backup.test.ts` (เข้ารหัส/กุญแจผิด · ลายเซ็น R2 ตรงกับ server · โฟลเดอร์ + R2 จำลอง · ลบชุดเก่ากว่า 90 วัน ไม่แตะโฟลเดอร์อื่น · ไดรฟ์ไม่ได้เสียบ = แจ้งไม่สำเร็จ)

## 9. ข้อมูลทดลองเครื่องขาย WTS-POS บนคลาวด์ (11/11/2569 · HANDOFF 116 — เจ้าของรัน)
```
node tools\cloud\pos-demo.mjs                                              (คลาวด์)
node tools/local-pg/pg.mjs run -- node tools/cloud/pos-demo.mjs --rehearse (ซ้อม: สำเนา DEMO ในเครื่อง + Buddy ชั่วคราว 4104 + WTS-POS ฐานชั่วคราว)
```
- บริษัทใน WTS-POS ที่เชื่อม Buddy (ปลายทาง buddy) · งานจริงอยู่ที่ `E:\WTS-POS\tools\hub\pos-demo.mts` (API ของ WTS-POS ในนามผู้ใช้ชั่วคราว pos.demo.seed แล้วปิด)
- Buddy: บริการ "ขายอาหาร (POS)" / "ขายเครื่องดื่ม (POS)" รายได้ 4100-01 — รหัส POS-FOOD/POS-BEV หรือ 30-SALE-FOOD/30-SALE-DRINK ถ้าบริษัทบังคับรูปแบบรหัส (DEMO = 99-!!!!-!!!!!!) · สร้างด้วยกุญแจ API ของบริษัท (ผู้ดูแลของลูกค้า — link-apps)
- WTS-POS: ดึงข้อมูลหลัก · QR → TB · บัตร → TK · ตั้งส่งเข้าบัญชี (เงินขาด/เกิน 4200-03) · เมนูร้านกาแฟ 14 · ร้าน CF01 (สาขาแรก · คลัง 01 · เงินสด 1111-00) · เครื่องขาย CF01-1/2 · พนักงาน C01/M01 (PIN) · บัตรกำนัล 50 บาท 3 ใบ
- กุญแจเครื่อง/ลิงก์จับคู่ (cashier.worktruesolution.net)/PIN → `.data\ข้อมูลเข้าทดลอง-เครื่องขาย-คลาวด์.txt` · ร้าน CF01 มีแล้ว = ไม่ทำซ้ำ
- 11/11/2569 แก้: เครื่องขายรุ่นแรกอยู่ในนามผู้ใช้ชั่วคราว (ปิดตอนจบ) = กุญแจใช้ไม่ได้ → รันซ้ำ = ซ่อม (ย้ายไปเจ้าของจริง + กุญแจ/PIN ใหม่) · จบแล้วลองกุญแจทุกเครื่องเอง

## 10. ตัวอย่างทั้งระบบ — บริษัท ดับบลิวทีเอส ฟู้ด (ทดลอง) (11/11/2569 · HANDOFF 117 — เจ้าของรัน)
```
node tools\cloud\food-demo.mjs                                              (คลาวด์ · 20–45 นาที)
node tools/local-pg/pg.mjs run -- node tools/cloud/food-demo.mjs --rehearse (ซ้อม: สำเนา DEMO + Buddy ชั่วคราว 4105 + WTS-POS ฐานชั่วคราว · --keep เก็บฐานไว้ดู)
```
- Buddy: บริษัทใหม่ WFOOD (`tools/cloud/food-company.mts` แบบ "กำหนดบริษัทใหม่" คัดลอกค่าตั้งจาก DEMO · ลูกค้าเดียวกัน) + กุญแจ API "WTS-POS (เชื่อมบนคลาวด์)" ของ WFOOD
- WTS-POS: บริษัท WF ผูกกับ WFOOD (link-buddy.mts · BUDDY_LINK_COMPANY=WF) แล้ว `E:\WTS-POS\tools\hub\food-demo.mts`:
  สาขา 00001–00003 · คลัง CK01 S01–S03 · วัตถุดิบ/ของครัวกลาง/สินค้าปลีก 31 · ซื้อเชื่อเข้าคลังก่อนเปิดขาย (RR) · เมนู 29 + สูตร + ตัวเลือก + รูป
  ร้าน S01 ร้านอาหาร (โต๊ะ) · S02 ร้านกาแฟ · S03 มินิมาร์ท · เครื่องขาย 4 · พนักงาน 7 (PIN) · ครัวกลาง CK01 · Grab/LINE MAN (ลูกหนี้) · สมาชิก/แต้ม/ระดับ · โปร 5 · คูปอง 2 · บัตรกำนัล
  ยอดขาย 14 วันแบบเครื่องขายจริง (applyPromotions/makeBillLines/summarizeDay) · วงเงินทอน + ฝากเงิน · ครัวกลางวันนี้ (ใบสั่ง→แผน→PO→ผลิต→ส่ง→รับขาด) · รับเงิน Grab · ส่งเข้า Buddy จนคิวว่าง · ตรวจงบทดลองสมดุล
- เงินสด HS แต่ละสาขาเข้า 1111-11/12/13 ผ่านวิธีรับชำระ C1/C2/C3 · สินค้ามีสต๊อก (ปลีก + ครัวซองต์) ตัดสต๊อกที่ตัวสินค้า: HS ใช้รหัสสินค้า จำนวนจริง คลังสาขา · กลุ่มบัญชี RTL รายได้ 4100-13 (POS 2569.11.11-6 ขึ้นไป)
- รุ่นก่อน 11/11/2569 ตั้งเป็น "สูตร 1 หน่วย" — รันซ้ำ = เปลี่ยนเมนูเป็นตัดที่ตัวสินค้า + ใส่กลุ่ม RTL ให้สินค้าเดิม (ยอดวันที่ส่งไปแล้วคงเดิม) · ซ้อมแบบนี้: `FD_FIRST_SCRIPT=tools/hub/<สคริปต์รุ่นเก่า>.mts` (ในโฟลเดอร์ WTS-POS) กับ `--rehearse`
- ใบกำกับเต็มรูป: เครื่องขายส่งรายการของบิลนั้นไปกับยอดวัน (summarizeDay `bills[].lines`) → HS ของลูกค้าตรงบิลจริง ไม่แบ่งยอดทั้งวันเป็นเศษ
- รันซ้ำได้: ของเดิมข้ามตามรหัส · ยอดขาย/ครัวกลาง/รับเงิน Grab ครั้งเดียว · กุญแจเครื่อง/PIN ออกใหม่ทุกครั้ง → `.data\ข้อมูลเข้า-ตัวอย่างทั้งระบบ.txt`

## 11. ตัวเฝ้าระบบ — แจ้งเตือนทางอีเมลเมื่อโปรแกรมบนคลาวด์ใช้ไม่ได้ (17/11/2569 · HANDOFF 121)

Worker แยก `wts-watch` (`cloud/watch/` · ไม่มี container · Workers Builds ของ repo ไม่ deploy ตัวนี้ — deploy จากเครื่องสำนักงาน)

- ตรวจทุก 1 นาที ผ่านชื่อเว็บสาธารณะที่ไม่มีด่าน Access: Buddy `buddy-api…/api/v1/health?db=1` (ตรวจฐานข้อมูลจริงด้วย — รุ่นที่มี `?db=1` ต้อง deploy Buddy ก่อน ถ้ายังไม่ deploy ตอบ ok เหมือนเดิม) · POS `cashier…/api/health` · Living `resident…/api/health`
- ใช้ไม่ได้ = ไม่ตอบใน 25 วินาที / ไม่ใช่ 200 / ไม่ใช่ JSON `ok: true` · ล้มติดกัน 5 ครั้ง (≈ 5 นาที) จึงแจ้ง (ไม่แจ้งตอน deploy/รีสตาร์ต) · เตือนซ้ำทุก 1 ชั่วโมง · กลับมา = แจ้งพร้อมเวลาที่ล่ม
- อีเมลแรกหลัง deploy = "เริ่มเฝ้าระบบแล้ว (อีเมลทดสอบ)" · ทุกจันทร์ 08:00 = สรุปรายสัปดาห์ (ไม่ได้รับ = ตัวเฝ้าอาจหยุด)
- ส่งด้วย Cloudflare Email Routing (`send_email`) จาก `alert@worktruesolution.net` ถึงอีเมลที่ยืนยันแล้วเท่านั้น · ส่งไม่ได้ = เก็บส่งใหม่รอบถัดไป (สูงสุด 20 ฉบับ)

ตั้งครั้งแรก:
1. เจ้าของ: Cloudflare › worktruesolution.net › Email › Email Routing › เปิดใช้ (โดเมนนี้ยังไม่มีอีเมล — เพิ่ม MX ได้ ไม่กระทบอะไร) › Destination addresses › เพิ่มอีเมลของเจ้าของ › กดลิงก์ยืนยันในอีเมล
2. ผู้ช่วย (ขออนุญาตก่อน): `npx wrangler deploy -c cloud/watch/wrangler.jsonc` แล้ว `npx wrangler secret put ALERT_TO -c cloud/watch/wrangler.jsonc` (อีเมลเจ้าของ — ไม่เก็บใน repo)
3. ภายใน 1–2 นาที เจ้าของได้อีเมล "เริ่มเฝ้าระบบแล้ว" · ดูบันทึก: `npx wrangler tail wts-watch`

ทดสอบในเครื่อง: `npx wrangler dev -c cloud/watch/wrangler.jsonc --test-scheduled --port 8799 --var ALERT_TO:owner@example.com` แล้วเปิด `http://127.0.0.1:8799/__scheduled?cron=*+*+*+*+*` (อีเมลบันทึกเป็นไฟล์ .eml ใน `cloud/watch/.wrangler/`) · ตรรกะทดสอบที่ `apps/server/test/watch.test.ts`

## 12. กันบอทที่หน้าเข้าระบบ/สมัครใช้งาน — Cloudflare Turnstile (20/11/2569 · HANDOFF 165 — เจ้าของทำ)
ยังไม่ตั้ง = หน้าจอไม่แสดงช่องตรวจ และโปรแกรมไม่ตรวจ (ทำงานเหมือนเดิม) · การจำกัดจำนวนครั้งต่อเครื่อง/รหัสผู้ใช้ทำงานอยู่แล้ว ไม่ต้องตั้งอะไร
1. เจ้าของ: Cloudflare (บัญชีที่มีโดเมน worktruesolution.net) › **Turnstile** › **Add widget**
   - Widget name: `Buddy Account` · Hostname: `app.worktruesolution.net` · Widget Mode: **Managed** › Create
   - หน้าถัดไปแสดง **Site Key** และ **Secret Key** (คัดลอกไว้ — Secret ห้ามส่งในแชต)
2. เจ้าของ: เปิดแท็บ Terminal ในแอป Claude แล้วพิมพ์เอง (ผู้ช่วยไม่พิมพ์ค่าเหล่านี้):
```powershell
cd E:\BuddyAccount
npx.cmd wrangler secret put TURNSTILE_SITE_KEY
npx.cmd wrangler secret put TURNSTILE_SECRET
```
   แต่ละคำสั่งจะถามค่า → วาง Site Key / Secret Key → Enter
3. ผู้ช่วย (ขออนุญาตก่อนตามปกติ): deploy รุ่นที่มี HANDOFF 165 — `cloud/worker.js` ส่ง TURNSTILE_SITE_KEY / TURNSTILE_SECRET เข้า container แล้ว
4. ตรวจ: เปิด https://app.worktruesolution.net → หน้าเข้าระบบมีกล่อง Cloudflare เหนือปุ่ม "เข้าสู่ระบบ" ขึ้นเครื่องหมายถูกเอง (Managed) แล้วเข้าระบบได้ตามปกติ · หน้า https://app.worktruesolution.net/signup ก็มีกล่องเดียวกัน
5. ยกเลิก: `npx.cmd wrangler secret delete TURNSTILE_SECRET` แล้ว deploy ใหม่ — กล่องหายไป ตรวจเหมือนเดิม
- เครื่องสำนักงาน (ไม่บังคับ): ใส่ตัวแปร TURNSTILE_SITE_KEY / TURNSTILE_SECRET ในตัวเปิดโปรแกรม แล้วเพิ่ม hostname ของเครื่องนั้นใน widget เดียวกัน
- จำกัดจำนวนครั้ง (ในหน่วยความจำของโปรแกรม — คลาวด์ container เดียว · เครื่องสำนักงานโปรแกรมเดียว): เข้าระบบ 30 ครั้ง/10 นาที/เครื่อง · 10 ครั้ง/10 นาที/รหัสผู้ใช้ · รหัสยืนยันตัวตนสองขั้น 20/10 นาที/เครื่อง · สมัครใช้งาน 10/ชั่วโมง/เครื่อง · เปลี่ยนรหัสผ่าน 10/10 นาที/ผู้ใช้ · เปิดลิงก์เชิญ 20/10 นาที/เครื่อง (HANDOFF 184) — ซ้อนกับล็อกบัญชีเมื่อใส่รหัสผิด 5 ครั้ง (15 นาที) เดิม · เกิน = ข้อความไทยบอกว่าลองใหม่ได้ในกี่นาที · IP จริงจาก Worker (CF-Connecting-IP) เท่านั้น — X-Forwarded-For ที่ผู้ใช้ส่งมาเองไม่มีผล

## 13. เอาด่าน Cloudflare Access ออก — Buddy เป็นด่านเดียว (24/11/2569 · HANDOFF 184 — เจ้าของทำเองที่ Cloudflare)
เจ้าของ: "ใช้แอปยืนยันตัวตน แต่ไม่อยากจะต้องมาใส่อีเมล์ให้ Cloudflare ทุกอีเมล์" — ตั้งแต่รุ่นที่มี HANDOFF 184 **ทุกผู้ใช้ต้องตั้งยืนยันตัวตนสองขั้น** (แอป Google/Microsoft Authenticator) และผู้ดูแลของลูกค้า **เชิญพนักงานด้วยลิงก์** ส่งทาง LINE ได้เอง ไม่ต้องเพิ่มอีเมลที่ Cloudflare
ผู้ช่วยไม่แตะนโยบาย Access — เจ้าของทำตามลำดับนี้ (ทำทีละข้อ ครบแล้วค่อยข้อถัดไป):

1. **รอผู้ช่วย deploy รุ่นที่มี HANDOFF 184** (ขออนุญาตก่อนตามปกติ) แล้วเข้าระบบ https://app.worktruesolution.net เอง — ถ้ายังไม่ได้ตั้งยืนยันตัวตนสองขั้น ระบบจะพาไปหน้าตั้งค่า (สแกน QR ด้วยแอปในมือถือ) เก็บรหัสสำรองไว้ด้วย
2. **ตั้งกุญแจ Turnstile** (ถ้ายังไม่ได้ตั้ง — ข้อ 12 ขั้น 1–2): Cloudflare › Turnstile › Add widget (Hostname `app.worktruesolution.net` · Managed) แล้วในแท็บ Terminal ของแอป Claude พิมพ์เอง:
```powershell
cd E:\BuddyAccount
npx.cmd wrangler secret put TURNSTILE_SITE_KEY
npx.cmd wrangler secret put TURNSTILE_SECRET
```
   แล้วบอกผู้ช่วยให้ deploy ใหม่ · ตรวจ: เปิด https://app.worktruesolution.net ต้องเห็นกล่อง Cloudflare เหนือปุ่ม "เข้าสู่ระบบ"
3. **ลองเชิญพนักงานทดลอง 1 คน**: https://app.worktruesolution.net/settings/users › เพิ่มผู้ใช้ › เลือก "ให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ" › บันทึก → ได้ลิงก์ + QR → เปิดลิงก์ในมือถือ (หรือหน้าต่างไม่ระบุตัวตน) ตั้งรหัสผ่าน แล้วตั้งยืนยันตัวตนสองขั้น — ลิงก์ต้องขึ้นต้นด้วย `https://app.worktruesolution.net/invite/` (ถ้าไม่ใช่ บอกผู้ช่วยให้ตั้ง BUDDY_PUBLIC_URL)
4. **เอาด่าน Access ออก**: https://one.dash.cloudflare.com › เลือกบัญชี › **Access controls › Applications** › แอปของ `app.worktruesolution.net` › **Delete** (หรือแก้ Policy เป็น Bypass — Everyone ถ้าอยากเก็บไว้เปิดกลับง่าย) → Save
   - **อย่าลบ** ของ `buddy-api` / กุญแจ API (ข้อ ซ ข้อ 6 ใน docs/21) — ลบเฉพาะด่านของหน้าเว็บ app
5. **ตรวจหลังเอาออก**: เปิด https://app.worktruesolution.net จากมือถือที่ไม่เคยเข้า (ปิด Wi-Fi ใช้ 4G) → ต้องเห็นหน้าเข้าระบบ Buddy ทันที (ไม่มีหน้าใส่อีเมลของ Cloudflare) + กล่อง Turnstile · เข้าระบบแล้วต้องถามรหัส 6 หลักจากแอป
6. 1–2 วันหลังเอาออก: อื่น ๆ › แฟ้มบันทึกเหตุการณ์ทำงาน ค้น `LOGIN_FAIL` — ถ้ามีมากผิดปกติ แจ้งผู้ช่วย · เปิดด่านกลับได้ทันทีที่ Cloudflare (ข้อ 4 ย้อนกลับ) ถ้ามีปัญหา

- ผู้ใช้เดิมที่ยังไม่ตั้งยืนยันตัวตนสองขั้น: **ไม่ถูกล็อก** — เข้าระบบด้วยรหัสผ่านเดิมแล้วถูกพาไปหน้าตั้งค่าก่อนใช้งานอื่น · มือถือหาย: ผู้ดูแลของลูกค้าเปิดผู้ใช้นั้น › "ล้างยืนยันตัวตนสองขั้น" แล้วผู้ใช้ตั้งใหม่ตอนเข้าระบบครั้งถัดไป
- ผู้ใช้ดูอย่างเดียว (ลูกค้าทดลอง · docs/21 ข้อ จ) ก็ต้องตั้งเช่นกัน — 1 รหัสผูกกับมือถือ 1 เครื่อง (แยกรหัสต่อคน ไม่ใช้รหัสร่วม)
- ลิงก์เชิญ: ใช้ได้ครั้งเดียว 72 ชั่วโมง · ออกใหม่ = ลิงก์เดิมใช้ไม่ได้ · ยกเลิกได้ · ระบบเก็บเฉพาะ hash · ผู้ดูแลไม่เห็นรหัสผ่าน · จำกัด 20 ครั้ง/10 นาที/เครื่อง + Turnstile ตอนตั้งรหัสผ่าน · บันทึก INVITE_CREATE / INVITE_REVOKE / INVITE_ACCEPT

## 14. อีเมลแจ้งใบสมัคร/อนุมัติ — Cloudflare Email Service (25/11/2569 · HANDOFF 187 — เจ้าของทำที่ Cloudflare)
เจ้าของ: "ระบบไม่ส่งอะไรตอบกลับลูกค้าทางอีเมล์" — รุ่นที่มี HANDOFF 187 ส่งอีเมล 4 แบบ: แจ้งผู้ให้บริการเมื่อมีใบสมัคร · ผู้สมัคร "ได้รับใบสมัครแล้ว" · "อนุมัติแล้ว" (ลิงก์ + วิธีเข้าระบบครั้งแรก) · "ไม่อนุมัติ"
- ส่งผ่าน **Cloudflare Email Service** (Email Sending — ยังเป็นรุ่น Beta) · Workers Paid ส่งได้ 3,000 ฉบับ/เดือน แล้ว $0.35 ต่อ 1,000 ฉบับ · ส่งถึงอีเมลใครก็ได้เมื่อ onboard โดเมนแล้ว
- โปรแกรมใน container เรียก binding `send_email` ของ Worker ตรงไม่ได้ → ส่งคำขอไปที่ Worker เอง (`/__wts/mail` · cloud/mail-relay.js) ยืนยันด้วยลายเซ็นจาก BUDDY_SECRET_KEY ที่มีอยู่แล้ว — **ไม่ต้องสร้าง API token หรือความลับใหม่**
- ยังไม่ onboard โดเมน = อีเมลส่งไม่สำเร็จ (ใบสมัคร/อนุมัติยังทำงานปกติ) หน้าลูกค้าผู้ใช้บริการแสดง "ส่งไม่สำเร็จ" ให้กด "ส่งอีกครั้ง" หลังตั้งเสร็จ

เจ้าของทำทีละข้อ (ครบข้อหนึ่งแล้วค่อยข้อถัดไป):
1. เปิด https://dash.cloudflare.com แล้วเลือกบัญชีที่มีโดเมน worktruesolution.net
2. เมนูซ้าย **Compute** › **Email Service** › **Email Sending** (ถ้าไม่เห็น ใช้ช่องค้นหาด้านบน พิมพ์ Email Sending)
3. กด **Onboard Domain** › เลือก **worktruesolution.net** › ดูรายการ DNS ที่จะเพิ่ม (MX และ SPF ที่ `cf-bounce` · DKIM · DMARC ที่ `_dmarc`) › กด **Done** — Cloudflare เพิ่มให้เอง เพราะ DNS อยู่ที่ Cloudflare อยู่แล้ว
4. รอ 5–15 นาที (นานสุด 24 ชั่วโมง) จนสถานะโดเมนพร้อมส่ง
5. บอกผู้ช่วยให้ deploy รุ่นที่มี HANDOFF 187 (ขออนุญาตก่อนตามปกติ) — wrangler.jsonc มี `send_email` และ `BUDDY_MAIL=cloudflare` แล้ว
6. เปิด https://app.worktruesolution.net/admin/tenants › กด **✉ ตั้งค่าอีเมลแจ้งเตือน** › ใส่ **อีเมลรับแจ้งเตือนใบสมัคร** (อีเมลของเจ้าของ คั่นด้วยจุลภาคได้หลายอีเมล) และ **ตอบกลับที่ (Reply-To)** (อีเมลที่อยากให้ผู้สมัครตอบกลับมา) › บันทึก — ผู้ส่งค่าเริ่มต้น noreply@worktruesolution.net
7. ทดลอง: ในหน้าต่างเดียวกันกดดู **ตัวอย่างอีเมล** ทั้ง 4 แบบ · แล้วสมัครทดลองที่ https://app.worktruesolution.net/signup ด้วยอีเมลของเจ้าของเอง → ควรได้ 2 ฉบับ (แจ้งผู้ให้บริการ + ได้รับใบสมัคร) · ไม่เห็นให้ดูโฟลเดอร์ Spam
8. ใบสมัครทดลองนั้นกด **ไม่อนุมัติ** (ใส่เหตุผล "ทดลองระบบ") → ควรได้อีเมล "ผลการพิจารณาใบสมัคร"
- สถานะอีเมลของแต่ละใบสมัครอยู่ในคอลัมน์ **อีเมล** ของรายการใบสมัคร (ส่งแล้ว / ส่งไม่สำเร็จ + เหตุผล / ไม่ได้ส่ง) · กด **ส่งอีกครั้ง** ได้ · ทุกครั้งบันทึกใน แฟ้มบันทึกเหตุการณ์ (MAIL_SENT / MAIL_FAILED / MAIL_SKIPPED)
- กันสแปม: ส่งถึงผู้สมัครเฉพาะอีเมลในใบสมัคร (ใบละ 1 อีเมล) · ไม่เกิน 3 ฉบับ/อีเมล/วัน · ซ้อนกับจำกัดใบสมัครต่อเครื่อง + Turnstile
- เครื่องสำนักงาน (ไม่ได้ตั้ง BUDDY_MAIL=cloudflare) = ไม่ส่งอีเมล บันทึกว่า "ไม่ได้ส่ง" อย่างเดียว
