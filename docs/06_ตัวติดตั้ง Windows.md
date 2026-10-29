# ตัวติดตั้ง Buddy Account บน Windows (T7.4)

ติดตั้งในเครื่องเดียว (หรือเป็นเครื่องหลักให้เครื่องอื่นในวง LAN ใช้) โดย**ไม่ต้องลงโปรแกรมอื่น** — ในชุดมี Node.js, PostgreSQL 16 และโปรแกรมครบ

## สร้างไฟล์ติดตั้ง (ฝั่งผู้พัฒนา)

```
pnpm build:installer          # = node tools/installer/build.mjs  (--no-exe = เฉพาะ zip · --skip-web = ไม่ build หน้าเว็บใหม่)
```

ผลลัพธ์ใน `dist-installer/` (ไม่อยู่ใน git):

| ไฟล์ | ใช้ |
|---|---|
| `BuddyAccount-<รุ่น>.exe` (~72 MB) | ไฟล์ติดตั้งไฟล์เดียว (IExpress ที่มากับ Windows) ดับเบิลคลิกได้เลย ไม่ขอสิทธิ์ผู้ดูแลเครื่อง (asInvoker) |
| `BuddyAccount-<รุ่น>.zip` (~74 MB) | สำรอง: แตกไฟล์แล้วคลิกขวา `install.ps1` > Run with PowerShell |
| `BuddyAccount/` (~200 MB) | โฟลเดอร์โปรแกรมที่จะถูกคัดลอกไปติดตั้ง |

รุ่น = `<version ใน package.json>-<วันที่>.<commit>` แสดงที่ Shift+F10 และ "แอปและฟีเจอร์"

## โครงสร้างที่ติดตั้ง

```
%LOCALAPPDATA%\Programs\BuddyAccount\      ← โปรแกรม (ถูกแทนที่ทั้งโฟลเดอร์ตอนอัปเดต)
  node\node.exe                            Node.js ตัวเดียวกับที่ใช้สร้าง
  app\launcher.mjs                         ตัวเปิด: ฐานข้อมูล → โปรแกรม → เบราว์เซอร์
  app\server\main.mjs, cli.mjs             โปรแกรมฝั่งเซิร์ฟเวอร์ (esbuild รวมไฟล์ + @buddy/core)
  app\pgsql\                               PostgreSQL 16 (embedded-postgres) + VC++ runtime วางคู่
  app\apps\web\dist  app\db\{migrations,seed,generated}   ไฟล์ที่โปรแกรมอ่าน (BUDDY_ROOT=app)
  app\node_modules\@electric-sql\pglite    โหมดฐานข้อมูลในตัว (สำรอง)
  Buddy Account.cmd · Stop Buddy Account.cmd · install.ps1 · uninstall.ps1 · อ่านก่อน.txt

%LOCALAPPDATA%\BuddyAccount\               ← ข้อมูล (ไม่ถูกลบตอนอัปเดต/ถอนการติดตั้ง · BUDDY_HOME เปลี่ยนได้)
  config.json      port 4100 · host 127.0.0.1 (0.0.0.0 = เปิดให้ LAN) · pgPort (พอร์ตว่างแรกตั้งแต่ 5546) · รหัสผ่านฐานข้อมูลสุ่ม
  pgdata\          ฐานข้อมูล PostgreSQL (รับเฉพาะ 127.0.0.1)
  logs\            server.log, postgres.log
```

ไอคอน: เดสก์ท็อป "Buddy Account" · เมนู Start > Buddy Account (เปิด / ปิด / โฟลเดอร์ข้อมูล / ถอนการติดตั้ง) · แสดงใน "แอปและฟีเจอร์" (HKCU)

## การทำงาน

- เปิดครั้งแรก: สร้างฐานข้อมูล (initdb UTF8, scram-sha-256) → migration → หน้า **ตั้งค่าครั้งแรก** ให้สร้างผู้ดูแลระบบ → สร้างบริษัท
- เปิดซ้ำขณะเปิดอยู่: เปิดเบราว์เซอร์อย่างเดียว · หน้าต่างดำ (ย่อไว้) ปิด = ปิดโปรแกรมและฐานข้อมูล
- อัปเดต: รันตัวติดตั้งรุ่นใหม่ — ปิดรุ่นเดิมให้เอง แล้วคัดลอกทับ migration ใหม่รันตอนเปิด
- ย้ายข้อมูลจากเครื่องพัฒนา/เครื่องอื่น: ตั้งค่า › สำรอง/นำกลับข้อมูล (ไฟล์ .buddy)
- พอร์ตชน: ข้อความบอกให้แก้ `port`/`pgPort` ใน config.json

## ทดสอบแล้ว (29/10/2569 บนเครื่องพัฒนา โฟลเดอร์/พอร์ตทดสอบแยก)

ติดตั้ง → เปิด (สร้างฐานข้อมูล 1 ครั้ง) → ตั้งผู้ดูแลผ่านหน้าจอ → สร้างบริษัทผังบัญชี Express (236 บัญชี) → ใบสำคัญ → งบทดลองสมดุล → เปิดซ้ำ → สถานะ → ปิด →
ติดตั้งทับ (อัปเดต) ข้อมูลยังอยู่ → ถอนการติดตั้ง (โปรแกรมหาย ข้อมูลอยู่) · แตก .exe (`/C /T:`) และ zip ด้วย tar ได้ไฟล์ครบ 1,940 ไฟล์

ยังไม่ได้ทดสอบ: เครื่อง Windows ที่ไม่เคยลงอะไรเลย (VC++ runtime ใส่มาให้แล้ว) · Windows SmartScreen อาจเตือน "ไม่รู้จักผู้เผยแพร่" เพราะยังไม่ได้เซ็นรหัส (code signing) — กด "ข้อมูลเพิ่มเติม" > "เรียกใช้ต่อไป"
