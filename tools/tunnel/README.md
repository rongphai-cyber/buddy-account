# ที่อยู่ https ของ Buddy สำหรับระบบอื่น (Cloudflare Tunnel)

ใช้ระหว่างที่ Buddy ยังอยู่บน PC — ให้เซิร์ฟเวอร์ของ WTS-SOP (Supabase Edge Function `buddy-post`) ส่งใบสำคัญเงินเดือนเข้ามาได้
ที่อยู่: `https://buddy.worktruesolution.net` → `http://127.0.0.1:4100` บนเครื่องนี้

## ตั้งไว้แล้ว (03/11/2569)
- tunnel แยกชื่อ `buddy-account` (ไม่แตะ tunnel `wts-erp-demo` ของ WTS-ERP)
- กุญแจ tunnel และ config อยู่ที่ `.data\cloudflared\` (ไม่เข้า git) · ตัวอย่าง config: `config.example.yml`
- **เปิดเฉพาะ** `/api/v1/gl/journals` `/api/v1/gl/books` `/api/v1/changes` — หน้าเว็บ หน้าเข้าระบบ และ API อื่นตอบ 404 จากอินเทอร์เน็ต
  ทุกคำขอต้องมีกุญแจ `bk_` (สร้างที่ เริ่มระบบ › กุญแจ API ผูกผู้ใช้ที่มีสิทธิ์แค่ใบสำคัญทั่วไป)
- `เปิด Buddy Account.cmd` เปิด tunnel ให้เองเป็นหน้าต่างย่อ "Buddy https" (ปิดหน้าต่างนั้น = ปิดที่อยู่ https)
  · ต้องเปิด Buddy ทิ้งไว้ WTS-SOP ถึงส่งได้ · ระหว่างปิด WTS-SOP จะลองส่งใหม่เอง (≤ 60 นาที)

## หน้าจอ Buddy ทั้งโปรแกรมผ่านอินเทอร์เน็ต: https://buddyapp.worktruesolution.net (เจ้าของ 07/11/2569 ทาง ก)
- tunnel เดิม `buddy-account` · ชื่อเว็บที่สอง `buddyapp.worktruesolution.net` → `http://127.0.0.1:4100` ทุก path (หน้าเว็บ + API)
  · `buddy.worktruesolution.net` ยังเปิดเฉพาะ 3 path ของ WTS-SOP เหมือนเดิม (**ห้ามใส่ชื่อนี้ใน Cloudflare Access** — WTS-SOP เป็นเครื่อง ยืนยันอีเมลไม่ได้)
- **ล็อกด้วย Cloudflare Access** (หัวข้อถัดไป): ต้องยืนยันอีเมลที่อนุญาตก่อนจึงเห็นหน้าเข้าระบบ · แล้วยังต้องรหัสผ่าน + ยืนยัน 2 ขั้นของ Buddy (ผู้ดูแล)
- เซิร์ฟเวอร์ (`app.ts` `trustProxy: ['127.0.0.1','::1']`) เชื่อ X-Forwarded-For/-Proto เฉพาะคำขอจาก cloudflared บนเครื่องนี้
  → ประวัติเข้าระบบเก็บ IP จริง · คุกกี้เข้าระบบ Secure เมื่อมาทาง https (`auth.ts cookieOpts`) · เครื่องอื่นในวงแลนปลอม header = ไม่เชื่อ (ทดสอบ `test/tunnel-https.test.ts`)
- ทำครั้งเดียว (เจ้าของ): `cloudflared tunnel --config E:\BuddyAccount\.data\cloudflared\config.yml route dns buddy-account buddyapp.worktruesolution.net`
  ผลต้องลงท้าย `tunnelID=073fa9ca-…`
- ตรวจ: `curl.exe -s -o NUL -w "%{http_code}\n" https://buddyapp.worktruesolution.net/` → ตั้ง Access แล้ว `302` · ยังไม่ตั้ง `200` · `530` = Buddy/tunnel ไม่ได้เปิด

## Cloudflare Access — ล็อก buddyapp และ living ให้เฉพาะอีเมลที่อนุญาต (เจ้าของทำในเว็บ Cloudflare · ฟรีไม่เกิน 50 คน)
1. เข้า https://one.dash.cloudflare.com → เลือกบัญชีที่ดูแลโดเมน worktruesolution.net
   · ครั้งแรก: ตั้งชื่อทีม (team name อะไรก็ได้ เช่น wts) → เลือกแผน **Free** (Cloudflare อาจขอบัตรไว้ในระบบ — แผน Free ไม่ตัดเงิน)
2. **Settings › Authentication › Login methods**: ต้องมี **One-time PIN** (มีให้อยู่แล้ว — รับรหัสทางอีเมล)
3. **Access › Applications › Add an application › Self-hosted**
   - Application name: `WTS ดูออนไลน์` · Session duration: `24 hours`
   - Application domain: `buddyapp` . `worktruesolution.net` → กด **Add domain** แล้วใส่ `living` . `worktruesolution.net` (ไม่ใส่ `buddy` และ `wtsprep`)
4. **Policy**: ชื่อ `เจ้าของและทีม` · Action **Allow** · Include → **Emails** → ใส่อีเมลที่อนุญาต (ของเจ้าของ + ทีมที่ให้ดู) → Save
5. ตรวจจากมือถือ: เปิด https://buddyapp.worktruesolution.net → หน้า Cloudflare ถามอีเมล → ใส่อีเมลที่อนุญาต → รหัส 6 หลักในอีเมล → เห็นหน้าเข้าระบบ Buddy
   · อีเมลที่ไม่อยู่ในรายชื่อ = ไม่ได้รับรหัส เข้าไม่ได้ · เพิ่ม/ลบคนได้ที่ Policy ข้อ 4
- เมนูในเว็บ Cloudflare อาจเปลี่ยนชื่อตามรุ่น — ส่งภาพหน้าจอให้ผู้ช่วยดูได้

## ทำครั้งเดียว (เจ้าของ — ระบบไม่ให้ผู้ช่วยแก้ DNS)
```
cloudflared tunnel --config E:\BuddyAccount\.data\cloudflared\config.yml route dns --overwrite-dns buddy-account buddy.worktruesolution.net
```
ต้องมี `--config` ของ Buddy เสมอ — ถ้าไม่ใส่ cloudflared ใช้ tunnel ใน `~\.cloudflared\config.yml` (wts-erp-demo) แทนชื่อที่พิมพ์
ตรวจ: ข้อความต้องลงท้าย `tunnelID=073fa9ca-…` ไม่ใช่ `b30887d3-…`

## ตรวจ
```
curl -s -o NUL -w "%{http_code}\n" https://buddy.worktruesolution.net/api/v1/changes
```
401 = ใช้ได้ (ถึง Buddy แล้ว ขาดกุญแจ) · 404 จาก `/` = ปิดหน้าเว็บไว้ถูกต้อง · 502/530 = Buddy หรือ tunnel ไม่ได้เปิด

## (ไม่บังคับ) ล็อกเพิ่มด้วย Cloudflare Access
Cloudflare Zero Trust › Access › Applications › เพิ่ม `buddy.worktruesolution.net` นโยบาย Service Auth + Service Token
→ ใส่ Secrets `BUDDY_CF_ACCESS_CLIENT_ID` / `BUDDY_CF_ACCESS_CLIENT_SECRET` ให้ฟังก์ชัน `buddy-post` ของ WTS-SOP
