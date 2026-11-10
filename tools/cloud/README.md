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
