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
