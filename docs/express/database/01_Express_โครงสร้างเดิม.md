# โครงสร้างข้อมูลเดิมของโปรแกรม Express

> อ่านจากแฟ้มจริงในโฟลเดอร์ `TESTRice` (FoxPro .DBF + ดัชนี .CDX, รหัสภาษาไทย Windows-874)
> คอลัมน์ "คีย์ (จาก .CDX)" คือ index expression จริงที่โปรแกรมใช้ — บอกคีย์หลักและเส้นทางค้นหา
> ไม่แสดงค่าตัวอย่างของฟิลด์ที่เป็นชื่อ ที่อยู่ เลขผู้เสียภาษี หรือข้อความอิสระ

**รวม 61 แฟ้ม · 1,931 ฟิลด์ · 349,148 ระเบียน**

## ตารางรหัสสำคัญ (ถอดจากข้อมูลจริง)

**ARTRN.RECTYP** — `0` AI รับเงินมัดจำ · `1` HS ขายเงินสด · `3` IV ขายเงินเชื่อ · `4` DR ใบเพิ่มหนี้ · `5` CN ใบลดหนี้/รับคืน · `7` OI รายได้อื่น · `9` RE รับชำระหนี้

**APTRN.RECTYP** — `0` AE จ่ายเงินมัดจำ/ทดรอง · `1` HP ซื้อเงินสด/จ่ายเงินสดย่อย · `3` RR ซื้อเงินเชื่อ · `4` CP ใบเพิ่มหนี้ · `5` DN ใบลดหนี้/ส่งคืน · `7` OE ค่าใช้จ่ายอื่น · `9` PS จ่ายชำระหนี้

**STCRD.POSOPR** — `` ไม่กระทบสต๊อก (บรรทัดมัดจำ/ยอดยกมา) · `0` ซื้อ/รับสินค้า (+) · `1` รับเข้า/ยอดยกมา/รับสำเร็จรูป (+) · `2` รับคืนจากลูกค้า (+) · `3` โอนเข้าคลังปลายทาง (+) · `4` โอนออกจากคลังต้นทาง (−) · `5` ปรับต้นทุน (มูลค่าอย่างเดียว) · `6` เบิกใช้/เบิกผลิต (−) · `7` ส่งคืนผู้จำหน่าย (−) · `8` ปรับปรุงจำนวน (± ตามเครื่องหมาย) · `9` ขาย (−) · `:` ปรับจากตรวจนับ (+) · `=` ใบเพิ่มหนี้ (ไม่กระทบ) · `>` ค่าใช้จ่ายอื่น (ไม่กระทบ)

**OESO.SORECTYP** — `0` SO ใบสั่งขาย · `5` QT ใบเสนอราคา

**BKTRN.BKTRNTYP** — `QR` เช็ครับ · `QP` เช็คจ่าย · `bR` โอนเข้า · `bP` โอนออก · `BT` โอนระหว่างบัญชี (ขาออก) · `Bx` โอนระหว่างบัญชี (ขาเข้า) · `BW` ถอนเงินสด

**GLPTT.RECTYP** — `0` VR เบิกชดเชยเงินสดย่อย · `1` DP จ่ายเงินสดย่อย

**STMAS.STKTYP** — `0` สินค้า · `1` สินค้าชุด · `2` บริการ · `4` รหัสรายได้อื่น · `5` รหัสค่าใช้จ่ายอื่น

***.DOCSTAT** — `N` ปกติ · `M` ใช้ครบ/ปิดแล้ว · `C` ยกเลิก

**BKTRN.CHQSTAT** — `00` เช็คในมือ · `01` รอเรียกเก็บ · `02` เช็คคืนยื่นใหม่ · `05` เช็คคืน · `10` ผ่านแล้ว · `19` ผ่านแล้ว (โอน)

**ISTAB.TABTYP** — `01` ธนาคาร · `02` สถานะเช็ค · `10` สมุดรายวัน · `20` หน่วยนับ · `21` คลังสินค้า · `22` หมวดสินค้า · `23` ระดับสินค้า · `40` เขตการขาย · `41` ขนส่งโดย · `42` เหตุผลยกเลิก (ขาย) · `43` เหตุผลยกเลิก (ซื้อ) · `44` สถานะใบเสนอราคา · `45` ประเภทลูกค้า · `46` ประเภทผู้จำหน่าย · `50` แผนก · `51` คำนำหน้าชื่อ · `52` หมวดทรัพย์สิน · `53` สถานะเงินสดย่อย · `55` แบบภาษีหัก ณ ที่จ่าย · `60` Collection/ฤดูกาล

**ISTAX.TAXTYP** — `S03` ภ.ง.ด.3 (บุคคลธรรมดา) · `S53` ภ.ง.ด.53 (นิติบุคคล) · `Z03/Z53` ภาษีที่ถูกหัก

**ISRUN.DOCTYP** — `GL` สมุดรายวัน (DOCCOD 00–04) · `ZR` วิธีรับเงิน · `ZP` วิธีจ่ายเงิน · `อื่นๆ` หมวดเอกสาร (PREFIX = prefix เอกสาร)

**ISINFO.ACCNUMnn** — `00` เงินสด · `01` (ว่าง) · `02` ลูกหนี้ · `03` เช็ครับ · `04` สินค้า · `05` ภาษีเงินได้จ่ายล่วงหน้า · `06` ภาษีซื้อ · `07` เจ้าหนี้ · `08` เช็คจ่าย · `09` ภาษีหัก ณ ที่จ่ายค้างจ่าย · `10` ภาษีขาย · `11` ขายสด · `12` ขายเชื่อ · `13` รับคืน · `14` ส่วนลดจ่าย · `15` ดอกเบี้ยรับ · `16` รายได้ธนาคาร · `17` ต้นทุนขาย · `18` ซื้อ · `19` ส่งคืน · `20` ส่วนลดรับ · `21` ดอกเบี้ยจ่าย · `22` ค่าธรรมเนียมธนาคาร · `23` กำไรสะสม · `24` บัญชีพัก · `25` หนี้สูญ · `26` รายได้อื่น · `27` ภาษีขายรอเรียกเก็บ · `28` ภาษีซื้อยังไม่ถึงกำหนด · `29` ค่าใช้จ่ายอื่น · `30` มัดจำจ่าย · `31` มัดจำรับ · `32` เงินสดย่อย · `33` ภาษีซื้อไม่ขอคืน · `34` ภาษีขอคืนไม่ได้

**ISACC (S).ACCNUM01–06** — `01` สินค้า (หรือบัญชีค่าใช้จ่าย สำหรับรหัสค่าใช้จ่าย) · `02` ต้นทุนขาย · `03` ขาย · `04` รับคืน · `05` ซื้อ · `06` ส่งคืน

**ISACC (F).ACCNUM01–03** — `01` ทรัพย์สิน · `02` ค่าเสื่อมราคา · `03` ค่าเสื่อมราคาสะสม

**ISRUN.ACCNUMnn (ยืนยันจากใบสำคัญจริง)** — `RR/CP/DN 3` บัญชีเจ้าหนี้แทนของผู้จำหน่าย · `HP 3 / PP 3` ส่วนขาดเกินการชำระ · `PP 4` บัญชีเครดิต (เจ้าหนี้เงินสดย่อย) · `RE 3,6 / PS 2,5` ส่วนขาดเกินการชำระ · `AE 1` บัญชีมัดจำ/เงินทดรองจ่าย · `AE 3` บัญชีจ่าย (เงินสดย่อย) · `AI 3` บัญชีมัดจำรับ · `HS 5` บัญชีขาย · `OU 1/2` เดบิต/เครดิตของการเบิก · `JU 1/2` เดบิต/เครดิตของการปรับปรุง · `CA 2` บัญชีคู่ของการปรับต้นทุน · `BD 2 / BW 1 / QP 1` บัญชีเงินสด · `BU 2` รายได้ดอกเบี้ย · `BV 1` ค่าใช้จ่ายธนาคาร · `BQ 2` ค่าธรรมเนียม

## ความสัมพันธ์ระหว่างแฟ้ม (ตรวจกับข้อมูลจริง)

| ฟิลด์ | อ้างถึง | จำนวนแถว | ตรง | หมายเหตุ |
|---|---|---|---|---|
| ARTRN.CUSCOD | ARMAS.CUSCOD | 2,267 | 100.0% | ยืนยันได้ |
| ARTRN.SLMCOD | OESLM.SLMCOD | 536 | 97.9% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| APTRN.SUPCOD | APMAS.SUPCOD | 13,975 | 99.9% | ยืนยันได้ |
| STCRD.STKCOD | STMAS.STKCOD | 105,816 | 100.0% | ยืนยันได้ |
| STCRD.DOCNUM | ARTRN.DOCNUM+APTRN.DOCNUM+STTRN.DOCNUM | 105,342 | 98.6% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| STCRD.LOCCOD | ISTAB.TYPCOD | 106,885 | 100.0% | ยืนยันได้ |
| STLOC.STKCOD | STMAS.STKCOD | 40,811 | 100.0% | ยืนยันได้ |
| OESOIT.SONUM | OESO.SONUM | 4,101 | 100.0% | ยืนยันได้ |
| OESOIT.STKCOD | STMAS.STKCOD | 4,101 | 100.0% | ยืนยันได้ |
| POPRIT.PONUM | POPR.PONUM | 19,290 | 100.0% | ยืนยันได้ |
| POPR.SUPCOD | APMAS.SUPCOD | 4,003 | 99.8% | ยืนยันได้ |
| OESO.CUSCOD | ARMAS.CUSCOD | 476 | 100.0% | ยืนยันได้ |
| ARTRN.SONUM | OESO.SONUM | 330 | 87.9% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| APTRN.PONUM | POPR.PONUM | 4,778 | 89.4% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| ARTRN.BILNUM | ARBIL.BILNUM | 1,304 | 99.8% | ยืนยันได้ |
| APTRN.BILNUM | APBIL.BILNUM | 3,778 | 100.0% | ยืนยันได้ |
| ARRCPIT.RCPNUM | ARTRN.DOCNUM | 1,390 | 99.0% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| ARRCPIT.DOCNUM | ARTRN.DOCNUM | 1,390 | 99.8% | ยืนยันได้ |
| APRCPIT.RCPNUM | APTRN.DOCNUM | 6,008 | 93.9% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| APRCPIT.DOCNUM | APTRN.DOCNUM | 6,008 | 99.8% | ยืนยันได้ |
| ARRCPCQ.RCPNUM | ARTRN.DOCNUM | 646 | 99.7% | ยืนยันได้ |
| ARRCPCQ.CHQNUM | BKTRN.CHQNUM | 646 | 30.0% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| APRCPCQ.RCPNUM | APTRN.DOCNUM+GLPTT.DOCNUM | 7,062 | 99.7% | ยืนยันได้ |
| APRCPCQ.CHQNUM | BKTRN.CHQNUM | 7,062 | 7.7% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| GLJNL.VOUCHER | ARTRN.DOCNUM+APTRN.DOCNUM+STTRN.DOCNUM+BKTRN.CHQNUM+GLPTT.DOCNUM | 16,765 | 96.5% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| GLJNLIT.VOUCHER | GLJNL.VOUCHER | 49,240 | 100.0% | ยืนยันได้ |
| GLJNLIT.ACCNUM | GLACC.ACCNUM | 49,240 | 100.0% | ยืนยันได้ |
| GLACC.PARENT | GLACC.ACCNUM | 285 | 100.0% | ยืนยันได้ |
| GLBAL.ACCNUM | GLACC.ACCNUM | 2,325 | 100.0% | ยืนยันได้ |
| ARMAS.ACCNUM | GLACC.ACCNUM | 129 | 100.0% | ยืนยันได้ |
| APMAS.ACCNUM | GLACC.ACCNUM | 1,087 | 100.0% | ยืนยันได้ |
| BKMAS.ACCNUM | GLACC.ACCNUM | 10 | 100.0% | ยืนยันได้ |
| STMAS.ACCCOD | ISACC.ACCCOD | 26,613 | 100.0% | ยืนยันได้ |
| FAMAS.ACCCOD | ISACC.ACCCOD | 578 | 100.0% | ยืนยันได้ |
| ISACC.ACCNUM01 | GLACC.ACCNUM | 176 | 100.0% | ยืนยันได้ |
| ISVAT.DOCNUM | ARTRN.DOCNUM+APTRN.DOCNUM+GLJNL.VOUCHER+GLPTT.DOCNUM+BKTRN.CHQNUM | 6,890 | 99.8% | ยืนยันได้ |
| ISTAX.REFNUM | APTRN.DOCNUM+ARTRN.DOCNUM+GLJNL.VOUCHER | 830 | 98.3% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| ISTAX.PEOPLE | APMAS.SUPCOD+ARMAS.CUSCOD | 830 | 95.7% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| BKTRN.BNKACC | BKMAS.BNKACC | 1,190 | 100.0% | ยืนยันได้ |
| BKTRN.CUSCOD | ARMAS.CUSCOD+APMAS.SUPCOD | 779 | 99.5% | ยืนยันได้ |
| BKTRN.VOUCHER | ARTRN.DOCNUM+APTRN.DOCNUM+GLJNL.VOUCHER | 872 | 98.1% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| ARTRNRM.DOCNUM | ARTRN.DOCNUM+APTRN.DOCNUM+OESO.SONUM+POPR.PONUM+STTRN.DOCNUM | 6,552 | 88.1% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| STCRD.PEOPLE | ARMAS.CUSCOD+APMAS.SUPCOD+ISTAB.TYPCOD | 78,575 | 100.0% | ยืนยันได้ |
| GLPTTIT.DOCNUM | GLPTT.DOCNUM | 2,204 | 89.7% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| STBOM.PSTKCOD | STMAS.STKCOD | 23 | 100.0% | ยืนยันได้ |
| STTAK.STKCOD | STMAS.STKCOD | 20,189 | 99.1% | ยืนยันได้ |
| ARTRN.ADVNUM | ARTRN.DOCNUM | 1,085 | 2.2% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| APTRN.ADVNUM | APTRN.DOCNUM | 3,407 | 14.7% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| STMAS.SUPCOD | APMAS.SUPCOD | 8,431 | 95.6% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |
| ARBAL.CUSCOD | ARMAS.CUSCOD | 129 | 100.0% | ยืนยันได้ |
| APBAL.SUPCOD | APMAS.SUPCOD | 1,091 | 100.0% | ยืนยันได้ |
| ARTRN.DEPCOD | ISTAB.TYPCOD | 11 | 100.0% | ยืนยันได้ |
| GLJNLIT.DEPCOD | ISTAB.TYPCOD | 4,001 | 100.0% | ยืนยันได้ |
| STMAS.QUCOD | ISTAB.TYPCOD | 26,622 | 68.8% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| STMAS.STKGRP | ISTAB.TYPCOD | 26,622 | 80.0% | ไม่ใช่ FK ตรงตัว (ดูหมายเหตุในพจนานุกรม) |
| ARMAS.AREACOD | ISTAB.TYPCOD | 38 | 97.4% | ส่วนใหญ่ตรง — ที่ไม่ตรงคือข้อมูลกำพร้า |

> หมายเหตุ: `ARRCPCQ/APRCPCQ.CHQNUM` ไม่ใช่ FK ไป BKTRN โดยตรง แต่ **2 ตัวแรกคือรหัสวิธีชำระใน ISRUN (ZR/ZP) — ตรง 100%** ส่วนที่เหลือคือเลขอ้างอิง; `ADVNUM` ที่เป็น "AI"/"AE" เฉยๆ หมายถึงไม่มีการหักมัดจำ

## ISINFO — ข้อมูลกิจการและค่าเริ่มต้นทั้งหมด (1 แถว)
ระเบียน 1 · ความยาวระเบียน 2202 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `THINAM` | C60 | 100 |  |  | sys_company.name_th |
| `ADDR01` | C50 | 100 |  |  | sys_company.address_th |
| `ADDR02` | C50 | 100 |  |  | sys_company.address_th |
| `TELNUM` | C50 | 100 |  |  | sys_company.phone |
| `ENGNAM` | C60 | 100 |  |  | sys_company.name_en |
| `ADDR01ENG` | C50 | 100 |  |  | sys_company.address_en |
| `ADDR02ENG` | C50 | 100 |  |  | sys_company.address_en |
| `TRDREG` | C15 | 100 |  |  | sys_company.trade_reg_no |
| `TAXID` | C15 | 100 | เลขผู้เสียภาษี |  | sys_company.tax_id |
| `LINKGL` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `VATRAT` | N5.2 | 100 | อัตรา VAT | 7.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `FLGVAT` | C1 | 100 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SEDITQU` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SEDITFAC` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CHGSALPR` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `LOSESAL` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_LT_REOP` | C1 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `INSERTIT` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `COST_ENC` | C10 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PVATPRORAT` | C1 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PVAT_RF` | N6.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PVAT_NRF` | N6.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ARPREFER` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APPREFER` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `STPREFER` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `GLPREFER` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CSHPURJNL` | C2 | 100 |  | 04 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CREPURJNL` | C2 | 100 |  | 04 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PURRETJNL` | C2 | 100 |  | 04 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `OTHEXPJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APRCPJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PASPCQJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CSHSALJNL` | C2 | 100 |  | 03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CRESALJNL` | C2 | 100 |  | 03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SALRETJNL` | C2 | 100 |  | 03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `OTHINCJNL` | C2 | 100 |  | 02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ARRCPJNL` | C2 | 100 |  | 02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PASRCQJNL` | C2 | 100 |  | 02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `INTISSJNL` | C2 | 100 |  | 00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `TAKADJJNL` | C2 | 100 |  | 00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `COSADJJNL` | C2 | 100 |  | 00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `BADDBTJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `BNKMOVJNL` | C2 | 100 |  | 00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `INCCHQJNL` | C2 | 100 |  | 02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `EXPCHQJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ARADVJNL` | C2 | 100 |  | 02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APADVJNL` | C2 | 100 |  | 01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `FADPRJNL` | C2 | 100 |  | 00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ARDNJNL` | C2 | 100 |  | 03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APCNJNL` | C2 | 100 |  | 04 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `COSMTD` | C1 | 100 |  | F | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `BNKDEP` | C2 | 100 |  | C2 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `BNKPAID` | C2 | 100 |  | C1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PASPCQAUTO` | C2 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM00` | C15 | 100 |  | 1111-00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM01` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM02` | C15 | 100 |  | 1130-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM03` | C15 | 100 |  | 1130-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM04` | C15 | 100 |  | 1140-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM05` | C15 | 100 |  | 1151-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM06` | C15 | 100 |  | 1154-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM07` | C15 | 100 |  | 2120-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM08` | C15 | 100 |  | 2120-03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM09` | C15 | 100 |  | 2132-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM10` | C15 | 100 |  | 2136-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM11` | C15 | 100 |  | 4100-11 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM12` | C15 | 100 |  | 4100-11 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM13` | C15 | 100 |  | 4100-30 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM14` | C15 | 100 |  | 4100-40 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM15` | C15 | 100 |  | 4300-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM16` | C15 | 100 |  | 4300-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM17` | C15 | 100 |  | 5110-00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM18` | C15 | 100 |  | 5130-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM19` | C15 | 100 |  | 5130-03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM20` | C15 | 100 |  | 5130-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM21` | C15 | 100 |  | 6000-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM22` | C15 | 100 |  | 5360-04 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM23` | C15 | 100 |  | 3200-00 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM24` | C15 | 100 |  | 9999-99 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM25` | C15 | 100 |  | 5390-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM26` | C15 | 100 |  | 4300-06 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM27` | C15 | 100 |  | 2136-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM28` | C15 | 100 |  | 1154-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM29` | C15 | 100 |  | 5380-06 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM30` | C15 | 100 |  | 1155-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM31` | C15 | 100 |  | 2135-02 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM32` | C15 | 100 |  | 1111-50 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM33` | C15 | 100 |  | 5390-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM34` | C15 | 100 |  | 5390-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ACCNUM35` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM36` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM37` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM38` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM39` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM40` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM41` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM42` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM43` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM44` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACCNUM45` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PT_STR1` | C15 | 100 |  | ชื้อสินค้า | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR1ENG` | C15 | 100 |  | Purchase | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PETTY1` | C15 | 100 |  | 5130-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR2` | C15 | 100 |  | วัสดุสิ้นเปลือง | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR2ENG` | C15 | 100 |  | Supplies | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PETTY2` | C15 | 100 |  | 5150-03 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR3` | C15 | 100 |  | ค่าน้ำมันรถ | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR3ENG` | C15 | 100 |  | Fuel | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PETTY3` | C15 | 100 |  | 5200-09 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR4` | C15 | 100 |  | ภาษีชื้อ | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR4ENG` | C15 | 100 |  | Input_VAT | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PETTY4` | C15 | 100 |  | 1154-01 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PT_STR5` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PT_STR5ENG` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PETTY5` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `GLPICT` | C15 | 100 |  | 9999-99 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `STPICT` | C20 | 100 |  | !!!!!!!!!!!!!!!!!!!! | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `FAPICT` | C15 | 100 |  | !-!!-!!!! | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `MAINLOC` | C4 | 100 |  | HO | sys_branch.default_warehouse_id |
| `NEGALLOW` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ISPERPETUA` | C1 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `YEARTHAI` | C1 | 100 |  | 1 | sys_company.year_system |
| `PEDITQU` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `PEDITFAC` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `TEDITQU` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `TEDITFAC` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `E_LPURSAL` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ARDUE1` | N3 | 100 |  | 30.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ARDUE2` | N3 | 100 |  | 60.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `AROVR1` | N3 | 100 |  | 15.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `AROVR2` | N3 | 100 |  | 30.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `AROVR3` | N3 | 100 |  | 60.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APDUE1` | N3 | 100 |  | 30.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APDUE2` | N3 | 100 |  | 60.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APOVR1` | N3 | 100 |  | 15.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APOVR2` | N3 | 100 |  | 30.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `APOVR3` | N3 | 100 |  | 60.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `QRDUE1` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QRDUE2` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QROVR1` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QROVR2` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QROVR3` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QPDUE1` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QPDUE2` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QPOVR1` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QPOVR2` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `QPOVR3` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STAGE1` | N3 | 100 |  | 30.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `STAGE2` | N3 | 100 |  | 60.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `STAGE3` | N3 | 100 |  | 90.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `GLRUNNING` | C1 | 100 |  | 4 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `USEDEP` | C1 | 100 | แยกแผนก | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CNDEDUCT` | C1 | 100 |  | 2 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `DNDEDUCT` | C1 | 100 |  | 2 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SAVSCRTIME` | N3 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ED_SSTKDES` | C1 | 100 |  |  | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ED_PSTKDES` | C1 | 100 |  |  | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `FADPRAUTO` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `FADPRMONLY` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `DPRMETHOD` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ONLINE` | C1 | 100 |  | N | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE1` | C1 | 100 |  | Y | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE2` | C1 | 100 |  | X | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE3` | N3 | 0 |  |  | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE4` | C30 | 100 |  |                Y     RPYYY PRS | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `USEPACKING` | C1 | 100 |  | 1 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `REPRNAUTH` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ABNORMEXIT` | C1 | 100 |  | X | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `OVRCRAUTH` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CHKNEGLEV` | C1 | 100 |  | 0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `NEGAUTH` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `WHOAMI` | C1 | 100 |  | 2 | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `MINTAXAMT` | B8.2 | 100 |  | 1000.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `MINTAXRAT` | N5.2 | 100 |  | 3.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SOCIALID` | C15 | 0 |  |  | sys_company.social_security_no |
| `POVDNTID` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DSIMLPRI` | N1 | 100 |  | 2.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `DSIMLQTY` | N1 | 100 |  | 2.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `DSIMLFAC` | N1 | 100 |  | 2.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ANYLOC` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `LOC_COST` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `LOC_DEP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USE_CQU` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_DAT1` | C20 | 100 |  | วันหมดอายุ | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_DAT1ENG` | C20 | 100 |  | Expire Date | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_DAT1USE` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_DAT2` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_DAT2ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_DAT2USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_NUM1` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_NUM1ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_NUM1USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ST_STR1` | C20 | 100 |  | Product | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR1ENG` | C20 | 100 |  | Product | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR1USE` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR2` | C20 | 100 |  | Collection | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR2ENG` | C20 | 100 |  | Collection | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR2USE` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR3` | C20 | 100 |  | รหัสสินค้าผู้ขาย | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR3ENG` | C20 | 100 |  | Supplier Goods Code | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR3USE` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR4` | C20 | 100 |  | Type Of Product | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR4ENG` | C20 | 100 |  | Type Of Product | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `ST_STR4USE` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `USEBARCOD` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SO_CR_LOCK` | C1 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SO_LOGLOC` | C1 | 100 |  | N | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `CRLINE_A` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_B` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_C` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_D` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_E` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_A_L` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_B_L` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_C_L` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_D_L` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CRLINE_E_L` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `OVRCRALLOW` | C1 | 100 |  | Y | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `USEJOB` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR1` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR1ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR1USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR2` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR2ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR2USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR3` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR3ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR3USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR4` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR4ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR4USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR5` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR5ENG` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JB_STR5USE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `POSTACC` | N4 | 100 |  | 232.0 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `SHAREFILE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `SRV_VATTYP` | C1 | 100 | เกณฑ์ภาษีบริการ 1=สิทธิ 2=เงินสด | 3 | (ย้ายเข้า sys_setting หรือพิจารณาเพิ่ม) |
| `REPRN_LEV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CANCEL_LEV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DELETE_LEV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `APPROV_MET` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `APPROV_LEV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `OVRLIN_LEV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VAT_INITEM` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## ISPRD — รอบบัญชี 24 งวด + สถานะปิดงวด (1 แถว)
ระเบียน 1 · ความยาวระเบียน 409 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| *(ฟิลด์รายงวด เช่น BEG1 …)* | | | ยอดสะสมแยก 12 งวดปีนี้/ปีหน้า/ปีก่อน | | (คำนวณจากรายการ) |

## ISRUN — ประเภทเอกสาร/เลขที่ถัดไป/สมุดรายวัน/วิธีรับ-จ่ายเงิน
ระเบียน 150 · ความยาวระเบียน 365 byte  
คีย์ (จาก .CDX): `DOCTYP` · `PREFIX` · `DOCTYP+DOCCOD` · `DOCTYP+PREFIX` · `DOCTYP+POSDES` · `DOCTYP+POSDES2`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `DOCTYP` | C2 | 99 | หมวดเอกสาร | ZP, ZR, JU | md_doc_type.doc_class; md_payment_method.direction |
| `DOCCOD` | C2 | 52 | ลำดับ/รหัสย่อย | 10, 01 | gl_journal_book.code; md_payment_method.seq |
| `SHORTNAM` | C6 | 10 | ชื่อย่อ |  | md_doc_type.short_name |
| `POSDES` | C30 | 100 | ชื่อประเภทเอกสาร |  | gl_journal_book.name_th; md_doc_type.name_th; md_payment_method.name_th |
| `POSDES2` | C30 | 99 | ชื่ออังกฤษ |  | gl_journal_book.name_en; md_doc_type.name_en; md_payment_method.name_en |
| `PREFIX` | C2 | 100 | prefix เลขที่ | ๙๙, QP, QR | gl_journal_book.prefix; md_doc_type.code; md_payment_method.code |
| `DOCNUM` | C10 | 75 | เลขที่เอกสาร | 0000001, 0000002 | md_doc_number_block.next_no |
| `ISMODIFY` | L1 | 99 |  | Y, F, T | (ใช้ภายใน — ไม่ย้าย) |
| `DEPCOD` | C4 | 0 | แผนก |  | md_doc_type.department_id |
| `JNLTYP` | C2 | 38 | สมุดรายวัน | 00, 04 | md_doc_type.journal_book_id |
| `JNLEXP` | C60 | 19 | สูตรคำอธิบายรายการบัญชี | 'ขายเชื่อให้   ' + (ARMAS->PRENAM - ' ' , ''  + (APMAS->PREN | md_doc_type.journal_desc_template |
| `ACCNUM01` | C15 | 56 |  | 5150-01, 5360-04 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM02` | C15 | 6 |  | 5110-00, 1111-50 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM03` | C15 | 6 |  | 5380-05, 2131-13 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM04` | C15 | 1 |  | 2140-00 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM05` | C15 | 1 |  | 4100-02, 5380-05 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM06` | C15 | 1 |  | 5380-05 | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM07` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM08` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM09` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM10` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM11` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `ACCNUM12` | C15 | 0 |  |  | md_doc_type_account.account_id (slot = เลขช่อง) |
| `FLGVAT` | C1 | 13 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 0, 2 | md_doc_type.price_type |
| `VATRAT` | N5.2 | 1 | อัตรา VAT | 7.0 | md_doc_type.vat_rate |
| `SRV_VATTYP` | C1 | 18 | เกณฑ์ภาษีบริการ 1=สิทธิ 2=เงินสด | N, Y | md_doc_type.vat_basis |
| `AUTOPRN` | C1 | 0 |  |  | md_doc_type.auto_print |
| `WHICHFORM` | C1 | 0 |  |  | md_doc_type.form_no |
| `REPRN_LEV` | C1 | 12 |  | 9 | md_doc_type.reprint_level |
| `CANCEL_LEV` | C1 | 0 |  |  | md_doc_type.cancel_level |
| `DELETE_LEV` | C1 | 0 |  |  | md_doc_type.delete_level |
| `APPROV_MET` | C1 | 12 |  | 1 | md_doc_type.approve_method |
| `APPROV_LEV` | C1 | 12 |  | 9 | md_doc_type.approve_level |
| `OVRLIN_LEV` | C1 | 0 |  |  | md_doc_type.over_limit_level |
| `VAT_INITEM` | C1 | 0 |  |  | md_doc_type.vat_per_line |
| `LOCCOD` | C4 | 4 | รหัสคลัง | HO | md_doc_type.warehouse_id |
| `USEBARCOD` | C1 | 0 |  |  | md_doc_type.use_barcode |
| `PVATPRORAT` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `RESERVE1` | C1 | 0 |  |  | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE2` | C4 | 0 |  |  | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `RESERVE3` | B8.4 | 0 |  |  | (ใช้ภายในโปรแกรม — ไม่ย้าย) |

## ISTAB — ตารางอ้างอิงทั่วไป (ตาม TABTYP)
ระเบียน 496 · ความยาวระเบียน 151 byte  
คีย์ (จาก .CDX): `TABTYP+TYPCOD` · `TYPCOD` FOR `.NOT.DELETED() .AND. TABTYP='50' .AND. DEPCOD#'N'` · `TYPCOD+SHORTNAM` FOR `.NOT.DELETED() .AND. TABTYP='51'` · `TABTYP+TYPCOD` FOR `.NOT.DELETED() .AND. STATUS # 'I'` · `FLD01+TYPCOD` FOR `.NOT.DELETED().AND.TABTYP='50'.AND.FLD01#' '` · `TABTYP+TYPDES` · `TABTYP+TYPDES2` · `TYPCOD+TYPDES` FOR `.NOT.DELETED().AND.TABTYP='51'`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `TABTYP` | C2 | 100 | ชนิดตาราง | 51, 22, 20 | md_lookup.type_code |
| `TYPCOD` | C4 | 100 | รหัส | 02, 72, 03 | md_bank.code; md_department.code; md_lookup.code; md_unit.code; md_warehouse.code |
| `SHORTNAM` | C15 | 58 | ชื่อย่อ |  | md_lookup.short_th |
| `SHORTNAM2` | C15 | 44 | ชื่อย่ออังกฤษ |  | md_lookup.short_en |
| `TYPDES` | C50 | 99 | ชื่อ |  | md_bank.name_th; md_department.name_th; md_lookup.name_th; md_unit.name_th; md_warehouse.name_th |
| `TYPDES2` | C50 | 51 | ชื่ออังกฤษ |  | md_bank.name_en; md_department.name_en; md_lookup.name_en; md_unit.name_en; md_warehouse.name_en |
| `FLD01` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `FLD02` | B8.4 | 3 |  | 1.0 | md_lookup.rate |
| `DEPCOD` | C4 | 0 | แผนก |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STATUS` | C1 | 0 | สถานะ |  | md_lookup.status |

## ISACC — กลุ่มบัญชีสินค้า (S) / ทรัพย์สิน (F)
ระเบียน 192 · ความยาวระเบียน 221 byte  
คีย์ (จาก .CDX): `ACCTYP+ACCCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `ACCTYP` | C1 | 100 | 0=ย่อย 1=คุม | S, F | แยกเป็น md_item_account_group (S) / md_asset_account_group (F) |
| `ACCCOD` | C4 | 100 |  | RM1, SEM1, INH1 | md_asset_account_group.code; md_item_account_group.code |
| `ACCDES` | C50 | 99 |  |  | md_asset_account_group.name_th; md_item_account_group.name_th |
| `ACCDES2` | C50 | 99 |  |  | md_asset_account_group.name_en; md_item_account_group.name_en |
| `METHOD` | C1 | 96 |  | -, F | md_item_account_group.cost_method |
| `ACCNUM01` | C15 | 92 |  | 1140-01, 1410-07 | md_asset_account_group.asset_account_id; md_item_account_group.inventory_account_id |
| `ACCNUM02` | C15 | 8 |  | 5110-00, 5340-06 | md_asset_account_group.depr_expense_account_id; md_item_account_group.cogs_account_id |
| `ACCNUM03` | C15 | 16 |  | 4100-13, 1420-06 | md_asset_account_group.accum_depr_account_id; md_item_account_group.sales_account_id |
| `ACCNUM04` | C15 | 11 |  | 4100-30, 4200-10 | md_item_account_group.sales_return_account_id |
| `ACCNUM05` | C15 | 4 |  | 5130-01, 5150-04 | md_item_account_group.purchase_account_id |
| `ACCNUM06` | C15 | 4 |  | 5130-03, 5150-04 | md_item_account_group.purchase_return_account_id |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | BIT9, MOOK, PLEACC | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20070103, 20061226, 20050213 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLACC — ผังบัญชี
ระเบียน 290 · ความยาวระเบียน 185 byte  
คีย์ (จาก .CDX): `ACCNUM` · `GROUP+ACCNUM` · `PARENT+ACCNUM` · `ACCNAM` · `ACCNAM2`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 1000-00, 1100-00, 1110-00 | gl_account.account_no |
| `ACCNAM` | C50 | 100 | ชื่อบัญชี |  | gl_account.name_th |
| `ACCNAM2` | C50 | 100 | ชื่อบัญชีอังกฤษ |  | gl_account.name_en |
| `LEVEL` | N1 | 100 |  | 4.0, 5.0, 3.0 | gl_account.level |
| `PARENT` | C15 | 98 | บัญชีคุม | 5310-00, 2131-00, 5200-00 | gl_account.parent_id |
| `GROUP` | C1 | 100 | หมวดบัญชี 1–5 | 5, 1, 2 | gl_account.account_group |
| `ACCTYP` | C1 | 100 | 0=ย่อย 1=คุม | 0, 1 | gl_account.is_control |
| `USEDEP` | C1 | 100 | แยกแผนก | Y, N | gl_account.use_department |
| `USEJOB` | C1 | 0 |  |  | gl_account.use_project |
| `NATURE` | C1 | 100 | 0=เดบิต 1=เครดิต | 0, 1 | gl_account.normal_side |
| `CONSOL` | C15 | 0 |  |  | gl_account.consol_account |
| `STATUS` | C1 | 100 | สถานะ | A | gl_account.status |
| `CREBY` | C8 | 59 | ผู้สร้าง | BIT9, CK | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 59 | วันที่สร้าง | 20050121, 20001027 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 84 | ผู้แก้ไขล่าสุด | BIT9, CK | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 84 | วันที่แก้ไขล่าสุด | 20050121, 20001027 | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## ARMAS — แฟ้มลูกค้า
ระเบียน 129 · ความยาวระเบียน 617 byte  
คีย์ (จาก .CDX): `CUSCOD` · `CUSNAM` · `CUSCOD` · `CUSNAM` · `CUSTYP+CUSCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | R-RICE, C-CCD, T-THE | md_customer.code |
| `CUSTYP` | C2 | 100 |  | 00, 01, 03 | md_customer.customer_type |
| `PRENAM` | C15 | 28 |  |  | md_customer.title |
| `CUSNAM` | C60 | 100 |  |  | md_customer.name |
| `ADDR01` | C50 | 95 |  |  | md_customer.address_1 |
| `ADDR02` | C50 | 84 |  |  | md_customer.address_2 |
| `ADDR03` | C30 | 43 |  |  | md_customer.address_3 |
| `ZIPCOD` | C5 | 43 |  | 50200, 50000 | md_customer.zip_code |
| `TELNUM` | C50 | 49 |  |  | md_customer.phone |
| `CONTACT` | C40 | 21 |  |  | md_customer.contact |
| `CUSNAM2` | C40 | 0 |  |  | md_customer.name_en |
| `TAXID` | C15 | 3 | เลขผู้เสียภาษี |  | md_customer.tax_id |
| `TAXTYP` | C25 | 0 | แบบ ภ.ง.ด. |  | md_customer.wht_form |
| `TAXRAT` | N5.2 | 0 | อัตราภาษีหัก ณ ที่จ่าย |  | md_customer.wht_rate |
| `TAXGRP` | C4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `TAXCOND` | C1 | 0 | เงื่อนไขการหัก |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `SHIPTO` | C10 | 0 | สถานที่ส่งของ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `SLMCOD` | C10 | 21 | พนักงานขาย | NP, AOM | md_customer.salesperson_id |
| `AREACOD` | C4 | 29 | เขตการขาย | 00, JP | md_customer.sales_area_code |
| `PAYTRM` | N3 | 19 | เครดิต (วัน) | 15.0, 60.0 | md_customer.credit_days |
| `PAYCOND` | C25 | 8 |  | 0, T/T | md_customer.payment_terms |
| `PAYER` | C10 | 0 |  |  | md_customer.payer_id |
| `TABPR` | C1 | 100 |  | 0, 1, 2 | md_customer.price_level |
| `DISC` | C10 | 0 | สูตรส่วนลด |  | md_customer.discount_text |
| `BALANCE` | B8.2 | 18 | ยอดคงเหลือ | 12499175.79, 15494791.07 | (คำนวณ: v_ar_outstanding) |
| `CHQRCV` | B8.2 | 1 | รับเป็นเช็ค/อื่น | 204219.0 | (คำนวณ: fin_cheque ที่ยังไม่ผ่าน) |
| `CRLINE` | B8.2 | 0 |  |  | md_customer.credit_limit |
| `LASIVC` | D8 | 61 |  | 20100831, 20101228 | (คำนวณ: max(doc_header.doc_date)) |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 1130-02, 1130-01, 2210-00 | md_customer.ar_account_id |
| `REMARK` | C50 | 9 |  |  | md_customer.remark |
| `DLVBY` | C2 | 9 | ขนส่งโดย | SE, 01 | md_customer.ship_via_code |
| `TRACKSAL` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CREBY` | C8 | 100 | ผู้สร้าง | PLEACC, BIT9, MOOK | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 100 | วันที่สร้าง | 20040531, 20050216, 20040514 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, NEUNG, AOM | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20050301, 20100621, 20050311 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `STATUS` | C1 | 3 | สถานะ | A, I | md_customer.status |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | md_customer.inactive_date |

## ARSHIP — สถานที่ส่งของลูกค้า
ระเบียน 9 · ความยาวระเบียน 255 byte  
คีย์ (จาก .CDX): `CUSCOD+SHIPTO` FOR `.NOT. DELETED()`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | @@@@@@@@@@, R-RICE | md_customer_ship_to.customer_id |
| `SHIPTO` | C10 | 100 | สถานที่ส่งของ | รง, RICE, PVC | md_customer_ship_to.code |
| `ADDR01` | C50 | 100 |  |  | md_customer_ship_to.address_1 |
| `ADDR02` | C50 | 22 |  |  | md_customer_ship_to.address_2 |
| `ADDR03` | C30 | 11 |  |  | md_customer_ship_to.address_3 |
| `ZIPCOD` | C5 | 56 |  | 10150, 10270 | md_customer_ship_to.zip_code |
| `TELNUM` | C50 | 44 |  |  | md_customer_ship_to.phone |
| `CONTACT` | C40 | 44 |  |  | md_customer_ship_to.contact |
| `STATUS` | C1 | 0 | สถานะ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## APMAS — แฟ้มผู้จำหน่าย
ระเบียน 1,091 · ความยาวระเบียน 578 byte  
คีย์ (จาก .CDX): `SUPCOD` · `SUPNAM` · `SUPCOD` · `SUPNAM` · `SUPTYP+SUPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | N-NOUL, V-VBUA, M-MED | md_supplier.code |
| `SUPTYP` | C2 | 100 |  | 00, 90, 91 | md_supplier.supplier_type |
| `ONHOLD` | C1 | 0 |  |  | md_supplier.on_hold |
| `PRENAM` | C15 | 70 |  |  | md_supplier.title |
| `SUPNAM` | C60 | 100 |  |  | md_supplier.name |
| `ADDR01` | C50 | 81 |  |  | md_supplier.address_1 |
| `ADDR02` | C50 | 66 |  |  | md_supplier.address_2 |
| `ADDR03` | C20 | 19 |  |  | md_supplier.address_3 |
| `ZIPCOD` | C5 | 53 |  | 50200, 50100 | md_supplier.zip_code |
| `TELNUM` | C50 | 60 |  |  | md_supplier.phone |
| `CONTACT` | C40 | 21 |  |  | md_supplier.contact |
| `SUPNAM2` | C40 | 0 |  |  | md_supplier.name_en |
| `PAYTRM` | N3 | 8 | เครดิต (วัน) | 30.0, 15.0 | md_supplier.credit_days |
| `PAYCOND` | C25 | 3 |  | เงินสด, Depsot 30% before and Bal | md_supplier.payment_terms |
| `DLVBY` | C2 | 1 | ขนส่งโดย | 01, บท | md_supplier.ship_via_code |
| `VATRAT` | N5.2 | 50 | อัตรา VAT | 7.0, 1.0 | md_supplier.vat_rate |
| `FLGVAT` | C1 | 100 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 0, 2, 1 | md_supplier.price_type |
| `DISC` | C10 | 0 | สูตรส่วนลด |        20% | md_supplier.discount_text |
| `BALANCE` | B8.2 | 8 | ยอดคงเหลือ | 54056.4, -98590.4 | (คำนวณ: v_ap_outstanding) |
| `CHQPAY` | B8.2 | 1 | จ่ายเป็นเช็ค/อื่น | 152435.41, 157225.21 | (คำนวณ: fin_cheque) |
| `CRLINE` | B8.2 | 0 |  | 100000.0 | md_supplier.credit_limit |
| `LASRCV` | D8 | 73 |  | 20101224, 20101130 | (คำนวณ: max(doc_header.doc_date)) |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 2120-01, 2131-15, 2131-13 | md_supplier.ap_account_id |
| `REMARK` | C50 | 8 |  |  | md_supplier.remark |
| `TAXID` | C15 | 43 | เลขผู้เสียภาษี |  | md_supplier.tax_id |
| `TAXDES` | C25 | 19 |  |  | md_supplier.wht_income_desc |
| `TAXRAT` | N5.2 | 15 | อัตราภาษีหัก ณ ที่จ่าย | 3.0 | md_supplier.wht_rate |
| `TAXTYP` | C4 | 15 | แบบ ภ.ง.ด. | S03, S53 | md_supplier.wht_form |
| `TAXCOND` | C1 | 14 | เงื่อนไขการหัก | 1, 2 | md_supplier.wht_condition |
| `CREBY` | C8 | 100 | ผู้สร้าง | PLEACC, MOOK, NUT | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 100 | วันที่สร้าง | 20080703, 20080208, 20050207 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | AOM, PLEACC, TS | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20100618, 20080602, 20050219 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `STATUS` | C1 | 0 | สถานะ |  | md_supplier.status |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | md_supplier.inactive_date |

## OESLM — พนักงานขาย
ระเบียน 5 · ความยาวระเบียน 537 byte  
คีย์ (จาก .CDX): `SLMCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SLMCOD` | C10 | 100 | พนักงานขาย | ANN, POOK, DAN | md_salesperson.code |
| `SLMNAM` | C45 | 100 |  |  | md_salesperson.name |
| `SLMTYP` | C2 | 0 |  |  | md_salesperson.salesperson_type |
| `COMRATE` | N5.2 | 0 |  |  | md_salesperson.commission_rate |
| `AREACOD` | C4 | 0 | เขตการขาย |  | md_salesperson.sales_area_code |
| `TAXID` | C15 | 0 | เลขผู้เสียภาษี |  | md_salesperson.tax_id |
| `POSITN` | C40 | 20 |  | Assistant Sales & Marketing Manager | md_salesperson.position |
| `SOCIALID` | C15 | 0 |  |  | md_salesperson.social_security_no |
| `ADDR01` | C50 | 20 |  |  | md_salesperson.address |
| `ADDR02` | C50 | 20 |  |  | md_salesperson.address |
| `ADDR03` | C20 | 20 |  |  | md_salesperson.address |
| `ZIPCOD` | C5 | 20 |  | 50140 | md_salesperson.address |
| `TELNUM` | C50 | 20 |  |  | md_salesperson.phone |
| `TAR1` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR2` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR3` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR4` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR5` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR6` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR7` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR8` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR9` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR10` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR11` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR12` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR1NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR2NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR3NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR4NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR5NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR6NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR7NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR8NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR9NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR10NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR11NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `TAR12NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `USERID` | C8 | 80 | ผู้แก้ไขล่าสุด | PEUNG, DAN | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 80 | วันที่แก้ไขล่าสุด | 20080911, 20100608 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CREATE` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STATUS` | C1 | 0 | สถานะ |  | md_salesperson.status |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## STMAS — แฟ้มสินค้า (รวมรหัสค่าใช้จ่ายอื่น/รายได้อื่น)
ระเบียน 26,622 · ความยาวระเบียน 643 byte  
คีย์ (จาก .CDX): `STKCOD` · `STKGRP+STKCOD` · `STKTYP+STKDES2` · `STKTYP+STKCOD` · `STKDES` · `STKTYP+STKDES` · `STKCOD` FOR `.NOT.DELETED() .AND. (STKTYP='1' .OR. STKTYP='2')` · `STKDES` FOR `.NOT.DELETED() .AND. (STKTYP='1' .OR. STKTYP='2')`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 100 | รหัสสินค้า | IC-MNCO-SY-LO, IC-13-2I-LO, IC-13-2P-OP | md_item.code |
| `STKDES` | C50 | 100 | ชื่อสินค้า |  | md_item.name_th |
| `STKDES2` | C50 | 78 |  |  | md_item.name_en |
| `STKTYP` | C1 | 100 |  | 0, 5, 4 | md_item.item_type |
| `STKLEV` | C2 | 0 |  | 11, 20 | md_item.item_level |
| `STKGRP` | C4 | 100 |  | EFB, 10, TMM | md_item.category_code |
| `BARCOD` | C20 | 14 |  | 5708315021080, 5708315021196 | md_item.barcode |
| `STKCODS` | C20 | 0 |  | ***, MELHE-GR | md_item.substitute_item_id |
| `ACCCOD` | C4 | 100 |  | ST01, RM1, INH1 | md_item.account_group_id |
| `ISINV` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STKCLASS` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `NEGALLOW` | C1 | 1 |  | N, Y | md_item.allow_negative |
| `QUCOD` | C2 | 100 |  | PC, ชน, MT | md_item.base_unit_id |
| `CQUCOD` | C2 | 9 |  | PC, ST | md_item.count_unit_id |
| `CFACTOR` | B8.4 | 11 |  | 1.0, 6.0 | md_item.count_factor |
| `STNPR` | B8.2 | 36 |  | 120.0, 100.0 | md_item.std_cost |
| `ISPUR` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PQUCOD` | C2 | 100 |  | PC, ชน, MT | md_item.purchase_unit_id |
| `PFACTOR` | B8.4 | 100 |  | 1.0, 0.9, 60.0 | md_item.purchase_factor |
| `LPURQU` | C2 | 35 |  | PC, MT | (คำนวณ: ราคาซื้อล่าสุดจาก doc_line / inv_stock_balance.last_purchase_date) |
| `LPURFAC` | B8.4 | 42 |  | 1.0, 0.9 | (คำนวณ: ราคาซื้อล่าสุดจาก doc_line / inv_stock_balance.last_purchase_date) |
| `LPURPR` | B8.4 | 27 |  | 100.0, 25.0 | (คำนวณ: ราคาซื้อล่าสุดจาก doc_line / inv_stock_balance.last_purchase_date) |
| `LPDISC` | C10 | 3 |  |       0.08,       0.01 | (คำนวณ: ราคาซื้อล่าสุดจาก doc_line / inv_stock_balance.last_purchase_date) |
| `LPURDAT` | D8 | 27 |  | 20101224, 20100810 | (คำนวณ: ราคาซื้อล่าสุดจาก doc_line / inv_stock_balance.last_purchase_date) |
| `SUPCOD` | C10 | 32 | รหัสผู้จำหน่าย | S-SRITHAI, B-BL | md_item.default_supplier_id |
| `ISSAL` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `SQUCOD` | C2 | 100 |  | PC, ชน, MT | md_item.sales_unit_id |
| `SFACTOR` | B8.4 | 100 |  | 1.0, 60.0, 12.0 | md_item.sales_factor |
| `SELLPR1` | B8.4 | 34 |  | 120.0, 100.0 | md_item.price_1 |
| `SELLPR2` | B8.4 | 0 |  | 361.0, 154.0 | md_item.price_2 |
| `SELLPR3` | B8.4 | 0 |  | 181.0, 65.0 | md_item.price_3 |
| `SELLPR4` | B8.4 | 0 |  | 65.0 | md_item.price_4 |
| `SELLPR5` | B8.4 | 0 |  | 65.0, 530.0 | md_item.price_5 |
| `TRACKSAL` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VATCOD` | C1 | 1 | ประเภท VAT รายบรรทัด | 1, 0 | md_item.vat_code |
| `ISCOM` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `COMRAT` | C10 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `LSELLQU` | C2 | 25 |  | PC, ST | (คำนวณ: ราคาขายล่าสุดจาก doc_line) |
| `LSELLFAC` | B8.4 | 61 |  | 1.0, 15.0 | (คำนวณ: ราคาขายล่าสุดจาก doc_line) |
| `LSELLPR` | B8.2 | 23 |  | 467.29, 747.66 | (คำนวณ: ราคาขายล่าสุดจาก doc_line) |
| `LSDISC` | C10 | 1 |  |     51.77%,        50% | (คำนวณ: ราคาขายล่าสุดจาก doc_line) |
| `LSELDAT` | D8 | 23 |  | 20100819, 20100223 | (คำนวณ: ราคาขายล่าสุดจาก doc_line) |
| `NUMELEM` | N4 | 0 |  | 2.0, 7.0 | (นับจาก md_item_bom) |
| `TOTBAL` | B8.4 | 34 |  | 1.0, 2.0 | (คำนวณ: รวม inv_stock_balance ทุกคลัง) |
| `TOTVAL` | B8.2 | 30 |  | 600.0, 300.0 | (คำนวณ: รวม inv_stock_balance ทุกคลัง) |
| `TOTREO` | B8.4 | 7 |  | 1.0, 10.0 | (คำนวณ: รวม inv_stock_balance ทุกคลัง) |
| `TOTRES` | B8.4 | 3 |  | 6.0, 1.0 | (คำนวณ: รวม inv_stock_balance ทุกคลัง) |
| `OPNBAL` | B8.4 | 10 |  | 1.0, 2.0 | (ยอดยกมา: doc_header OB + doc_line) |
| `UNITPR` | B8.4 | 33 | ราคาต่อหน่วย | 60.0, 100.0 | (คำนวณ: inv_stock_balance.avg_cost) |
| `OPNVAL` | B8.2 | 9 |  | 240.0, 180.0 | (ยอดยกมา: doc_header OB + doc_line) |
| `LASUPD` | D8 | 96 |  | 20081231, 20100228 | (คำนวณ: inv_stock_balance.last_move_date) |
| `PACKING` | C15 | 3 |  | 12/inner, PER12 | md_item.packing |
| `MLOTNUM` | C24 | 95 | ล็อต FIFO (วันที่+เอกสาร+ลำดับที่รับเข้า) |         1              1, -, -       1              1 | (inv_cost_layer) |
| `MREMBAL` | B8.4 | 22 | คงเหลือในล็อต | 1.0, 2.0 | (inv_cost_layer) |
| `MREMVAL` | B8.2 | 21 | มูลค่าคงเหลือในล็อต | 150.0, 300.0 | (inv_cost_layer) |
| `REMARK` | C50 | 11 |  |  | md_item.remark |
| `DAT1` | D8 | 0 |  |  | md_item.udf_date_1 |
| `DAT2` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `NUM1` | B8.4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR1` | C4 | 0 |  | INH, TRD | md_item.udf_1 |
| `STR2` | C4 | 4 |  | SS09, AW08 | md_item.udf_2 |
| `STR3` | C15 | 0 |  |  | md_item.udf_3 |
| `STR4` | C30 | 0 |  | Melamine, Plastic | md_item.udf_4 |
| `CREBY` | C8 | 2 | ผู้สร้าง | KING, TAE | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 2 | วันที่สร้าง | 20101124, 20101207 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 95 | ผู้แก้ไขล่าสุด | NUT, PLE, PLEACC | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 95 | วันที่แก้ไขล่าสุด | 20090614, 20050627 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `STATUS` | C1 | 0 | สถานะ |  | md_item.status |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | md_item.inactive_date |

## STBOM — ส่วนประกอบสินค้าชุด
ระเบียน 23 · ความยาวระเบียน 72 byte  
คีย์ (จาก .CDX): `PSTKCOD+SEQNUM` · `STKCOD+PSTKCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `PSTKCOD` | C20 | 100 | สินค้าชุดแม่ | MELEG-XC06, MELDB-6GOXC, FRPIC-BOW | md_item_bom.parent_item_id |
| `SEQNUM` | C3 | 100 | ลำดับบรรทัด |   1,   2,   3 | md_item_bom.line_no |
| `STKCOD` | C20 | 100 | รหัสสินค้า | FRPIC, WRAP-BX, MELEG-B | md_item_bom.component_item_id |
| `BOMQTY` | B8.4 | 100 |  | 1.0, 15.0 | md_item_bom.qty |
| `LOCCOD` | C4 | 0 | รหัสคลัง |  | md_item_bom.warehouse_id |
| `STNPR` | B8.4 | 100 |  | 8.0, 8.4, 77.0 | md_item_bom.std_cost |
| `SELLPR` | B8.4 | 30 |  | 8.6, 15.5 | md_item_bom.sell_price |

## STPRI — ตารางราคาตามปริมาณ
ระเบียน 0 · ความยาวระเบียน 112 byte  
คีย์ (จาก .CDX): `STKCOD+QU+STR(QTY,12,4)+DTOS(START)` · `STKCOD+STR(FACTOR,12,4)+QU+STR(QTY,12,4)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 0 | รหัสสินค้า |  | md_item_price_break.item_id |
| `QU` | C2 | 0 |  |  | md_item_price_break.unit_id |
| `FACTOR` | B8.4 | 0 |  |  | md_item_price_break.factor |
| `QTY` | B8.4 | 0 |  |  | md_item_price_break.min_qty |
| `PERCENT` | C1 | 0 |  |  | md_item_price_break.is_percent |
| `SELLPR1` | B8.4 | 0 |  |  | md_item_price_break.price_1 |
| `SELLPR2` | B8.4 | 0 |  |  | md_item_price_break.price_2 |
| `SELLPR3` | B8.4 | 0 |  |  | md_item_price_break.price_3 |
| `SELLPR4` | B8.4 | 0 |  |  | md_item_price_break.price_4 |
| `SELLPR5` | B8.4 | 0 |  |  | md_item_price_break.price_5 |
| `START` | D8 | 0 |  |  | md_item_price_break.start_date |
| `END` | D8 | 0 |  |  | md_item_price_break.end_date |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## STMIN — จุดสั่งซื้อ
ระเบียน 0 · ความยาวระเบียน 62 byte  
คีย์ (จาก .CDX): `STKCOD+LOCCOD+MMDD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 0 | รหัสสินค้า |  | md_item_reorder.item_id |
| `LOCCOD` | C4 | 0 | รหัสคลัง |  | md_item_reorder.warehouse_id |
| `MMDD` | C5 | 0 |  |  | md_item_reorder.start_mmdd |
| `MINQTY` | B8.4 | 0 |  |  | md_item_reorder.min_qty |
| `MAXQTY` | B8.4 | 0 |  |  | md_item_reorder.max_qty |
| `REOQTY` | B8.4 | 0 |  |  | md_item_reorder.order_qty |
| `PRJSAL` | B8.4 | 0 |  |  | md_item_reorder.projected_sales |

## STCOD — รหัสสินค้าของคู่ค้า
ระเบียน 0 · ความยาวระเบียน 103 byte  
คีย์ (จาก .CDX): `STKCOD+WHATAPP+PEOPLE` · `STKCOD+WHATAPP+PRIORITY`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 0 | รหัสสินค้า |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `WHATAPP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRIORITY` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PEOPLE` | C10 | 0 | คู่ค้า/คลังปลายทาง |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `HISCOD` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `HISDES` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## BKMAS — บัญชีเงินฝากของกิจการ
ระเบียน 10 · ความยาวระเบียน 152 byte  
คีย์ (จาก .CDX): `BNKACC` · `BNKNAM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BNKACC` | C2 | 100 | บัญชีเงินฝาก | C1, C2, S1 | md_bank_account.code |
| `BNKNAM` | C50 | 100 |  |  | md_bank_account.name |
| `BRANCH` | C30 | 100 |  | กาดสวนแก้ว, ย่อยช้างคลาน, ถนนช้างคลาน | md_bank_account.branch |
| `SHORTNAM` | C10 | 100 | ชื่อย่อ |  | md_bank_account.short_name |
| `BNKNUM` | C12 | 100 |  |  | md_bank_account.account_number |
| `BALFWD` | B8.2 | 0 |  |  | md_bank_account.opening_balance |
| `BALDAT` | D8 | 0 |  |  | md_bank_account.opening_date |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 1112-01, 1112-02, 1113-01 | md_bank_account.gl_account_id |
| `USERID` | C8 | 30 | ผู้แก้ไขล่าสุด | BIT9 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 30 | วันที่แก้ไขล่าสุด | 20050121 | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## FAMAS — ทะเบียนทรัพย์สิน + ค่าเสื่อมรายงวด
ระเบียน 578 · ความยาวระเบียน 455 byte  
คีย์ (จาก .CDX): `FASCOD` · `FASDES` · `FASDES2` · `DEPCOD+DTOS(PURDAT)` · `DTOS(PURDAT)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `FASCOD` | C15 | 100 |  | O-40-0001, O-40-0002, O-41-0001 | fa_asset.code |
| `FASDES` | C45 | 100 |  |  | fa_asset.name_th |
| `FASDES2` | C45 | 94 |  |  | fa_asset.name_en |
| `FASGRP` | C2 | 100 |  | EQ, ET, FU | fa_asset.category_code |
| `FASTYP` | C1 | 100 |  | Y, N | fa_asset.is_depreciable |
| `SERIAL` | C15 | 0 |  |  | fa_asset.serial_no |
| `DEPCOD` | C4 | 0 | แผนก | EXP | fa_asset.department_id |
| `PURDAT` | D8 | 100 |  | 20080724, 20071203, 20080811 | fa_asset.purchase_date |
| `COSVAL` | B8.2 | 100 |  | 2242.99, 8500.0, 14000.0 | fa_asset.cost |
| `SALVAG` | B8.2 | 100 |  | 1.0, 2.0, 3.0 | fa_asset.salvage_value |
| `METHOD` | C1 | 100 |  | 1, 2, 0 | fa_asset.method |
| `STRDAT` | D8 | 100 |  | 20080724, 20071203, 20080811 | fa_asset.start_date |
| `LIFE` | N2 | 90 |  | 5.0, 3.0 | fa_asset.useful_life_years |
| `RATE` | N6.2 | 100 |  | 20.0, 33.33, 5.0 | fa_asset.rate |
| `ENDDAT` | D8 | 100 |  | 20130724, 20121203, 20130811 | fa_asset.end_date |
| `ACCCOD` | C4 | 100 |  | OE, ET, FE | fa_asset.account_group_id |
| `DPRMONLY` | C1 | 100 |  | Y | fa_asset.depr_monthly |
| `ACCMBF` | B8.2 | 73 |  | 175.19, 73.5 | fa_asset.accum_depr_bf |
| `DPRAMT` | B8.2 | 2 |  | 13770.0, 10950.0 | (คำนวณ: ค่าเสื่อมทั้งปีจาก fa_depreciation) |
| `YTDAMT` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `LASCAL` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `SALDAT` | D8 | 0 |  |  | fa_asset.sold_date |
| `SALAMT` | B8.2 | 0 |  |  | fa_asset.sold_amount |
| `STATUS` | C1 | 0 | สถานะ |  | fa_asset.status |
| `CREBY` | C8 | 100 | ผู้สร้าง | PLEACC, BIT9, NING | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 100 | วันที่สร้าง | 20050603, 20050604, 20090318 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, BIT9, TS | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20050603, 20090318, 20090320 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `DEPR1` | B8.2 | 57 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR2` | B8.2 | 57 |  | 34.4, 12.82 | fa_depreciation.amount |
| `DEPR3` | B8.2 | 59 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR4` | B8.2 | 59 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR5` | B8.2 | 60 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR6` | B8.2 | 61 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR7` | B8.2 | 61 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR8` | B8.2 | 62 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR9` | B8.2 | 62 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR10` | B8.2 | 64 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR11` | B8.2 | 66 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR12` | B8.2 | 67 |  | 38.12, 14.2 | fa_depreciation.amount |
| `DEPR1NY` | B8.2 | 68 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR2NY` | B8.2 | 68 |  | 34.4, 12.82 | fa_depreciation.amount |
| `DEPR3NY` | B8.2 | 69 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR4NY` | B8.2 | 70 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR5NY` | B8.2 | 70 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR6NY` | B8.2 | 71 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR7NY` | B8.2 | 72 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR8NY` | B8.2 | 72 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR9NY` | B8.2 | 72 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR10NY` | B8.2 | 73 |  | 38.08, 14.19 | fa_depreciation.amount |
| `DEPR11NY` | B8.2 | 75 |  | 36.85, 13.73 | fa_depreciation.amount |
| `DEPR12NY` | B8.2 | 75 |  | 38.12, 14.2 | fa_depreciation.amount |

## JBMAS — โครงการ/Job
ระเบียน 1 · ความยาวระเบียน 528 byte  
คีย์ (จาก .CDX): `JOBCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `JOBCOD` | C6 | 100 | โครงการ | C1000 | md_project.code |
| `JOBTYP` | C10 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `JOBNAM` | C50 | 100 |  |  | md_project.name_th |
| `JOBNAM2` | C50 | 100 |  |  | md_project.name_en |
| `PONUM` | C15 | 0 | เลขที่ใบสั่งซื้อที่อ้างถึง |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CONTACT` | C40 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `MANAGER` | C40 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STATUS` | C1 | 0 | สถานะ |  | md_project.status |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `LASDAT` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR1` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR2` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR3` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR4` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STR5` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `BEGIN` | D8 | 100 |  | 19990101 | md_project.start_date |
| `END` | D8 | 100 |  | 20001231 | md_project.end_date |
| `PERCENT` | N6.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CUSCOD` | C10 | 0 | รหัสลูกค้า |  | md_project.customer_id |
| `REIMBURS` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | CK | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 19991025 | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## JBLIST — งบประมาณโครงการ
ระเบียน 3 · ความยาวระเบียน 101 byte  
คีย์ (จาก .CDX): `JOBCOD+PHASE+COSCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `JOBCOD` | C6 | 100 | โครงการ | C1000 | md_project_budget.project_id |
| `PHASE` | C4 | 100 | ขั้นตอน | P-02, P-01 | md_project_budget.phase |
| `COSCOD` | C4 | 67 | รหัสต้นทุน | C-01, C-02 | md_project_budget.cost_code |
| `ESTEXP` | N14.2 | 100 |  | 150000.0, 10000.0, 50000.0 | md_project_budget.est_expense |
| `ESTREV` | N14.2 | 0 |  |  | md_project_budget.est_revenue |
| `ACTEXP` | N14.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `ACTREV` | N14.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DESCRP` | C30 | 0 | คำอธิบาย |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## OESO — หัวใบสั่งขาย/ใบเสนอราคา
ระเบียน 476 · ความยาวระเบียน 259 byte  
คีย์ (จาก .CDX): `SONUM` · `CUSCOD+DOCSTAT+SONUM` · `SORECTYP+SONUM` · `DTOS(SODAT)` · `SLMCOD` · `AREACOD` · `SORECTYP`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SORECTYP` | C1 | 100 |  | 0, 5 | doc_header.doc_class |
| `SONUM` | C12 | 100 | เลขที่ใบสั่งขายที่อ้างถึง | SO0097124, SO0097186, SO0097113 | doc_header.doc_no |
| `SODAT` | D8 | 100 |  | 20100628, 20081225, 20080911 | doc_header.doc_date |
| `FLGVAT` | C1 | 100 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 2, 0, 1 | doc_header.price_type |
| `DEPCOD` | C4 | 6 | แผนก | MKT | doc_header.department_id |
| `SLMCOD` | C10 | 99 | พนักงานขาย | DAN, AOM, NP | doc_header.salesperson_id |
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | R-RICE, L-LAU, C-CHICHANG | doc_header.customer_id |
| `SHIPTO` | C10 | 0 | สถานที่ส่งของ | 001 | doc_header.ship_to_id |
| `YOUREF` | C30 | 95 | อ้างอิง |  | doc_header.your_ref |
| `RFF` | C12 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `AREACOD` | C4 | 15 | เขตการขาย | UK, DKK | doc_header.sales_area_code |
| `PAYTRM` | N3 | 98 | เครดิต (วัน) | 15.0, 60.0, 30.0 | doc_header.credit_days |
| `DLVDAT` | D8 | 100 |  | 20090501, 20100420, 20100215 | doc_header.delivery_date |
| `DLVTIM` | C4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DLVDAT_IT` | C1 | 1 |  | Y, N | doc_header.delivery_date_per_line |
| `NXTSEQ` | C3 | 100 | ลำดับบรรทัดถัดไป (-1 = เอกสารยกเลิก) |   1,   2,   3 | (ใช้ภายใน: ลำดับบรรทัดถัดไป / -1 = ยกเลิก — ไม่ต้องเก็บ) |
| `AMOUNT` | B8.2 | 99 | จำนวนเงิน | 292200.0, 241200.0 | doc_header.amount |
| `DISC` | C10 | 0 | สูตรส่วนลด |  | doc_header.discount_text |
| `DISCAMT` | B8.2 | 0 | ส่วนลด |  | doc_header.discount_amount |
| `TOTAL` | B8.2 | 99 | มูลค่าก่อน VAT | 292200.0, 241200.0 | doc_header.taxable_amount |
| `AMTRAT0` | B8.2 | 0 | มูลค่าอัตรา 0% |  | doc_header.zero_rate_amount |
| `VATRAT` | N5.2 | 8 | อัตรา VAT | 7.0 | doc_header.vat_rate |
| `VATAMT` | B8.2 | 4 | ภาษีมูลค่าเพิ่ม | 0.32, 9626.64 | doc_header.vat_amount |
| `NETAMT` | B8.2 | 99 | ยอดสุทธิ | 241200.0, 335808.0 | doc_header.net_amount |
| `NETVAL` | B8.2 | 99 | มูลค่าสุทธิ | 292200.0, 241200.0 | doc_header.taxable_amount |
| `CMPLDAT` | D8 | 51 | วันที่ครบ | 20090715, 20090210 | doc_header.settled_date |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | M, N, C | doc_header.doc_status |
| `DLVBY` | C2 | 15 | ขนส่งโดย | SE, 01 | doc_header.ship_via_code |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | DAN, MOOK, YOON | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20080922, 20100628, 20081225 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 1 | ผู้พิมพ์ | PEUNG, TS | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 1 | วันที่พิมพ์ | 20081128, 20080509 | last_printed_at |
| `PRNCNT` | N2 | 1 | จำนวนครั้งที่พิมพ์ | 1.0, 6.0 | doc_header.print_count |
| `PRNTIM` | C5 | 1 | เวลาพิมพ์ | 14:10, 16:15 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | doc_header.approved_by |

## OESOIT — รายการใบสั่งขาย/ใบเสนอราคา
ระเบียน 4,101 · ความยาวระเบียน 216 byte  
คีย์ (จาก .CDX): `SONUM+SEQNUM` · `CUSCOD+DTOS(DLVDAT)+SONUM+SEQNUM` · `STKCOD+LOCCOD+DTOS(DLVDAT)+SONUM+SEQNUM` · `CUSCOD+STKCOD+TQUCOD+STR(ORDQTY,10,4)+DTOS(SODAT)` · `CUSCOD+DTOS(DLVDAT)+SONUM+SEQNUM` FOR `.NOT.DELETED() .AND. REMQTY >= 0.0001` · `CUSCOD` · `STKCOD` · `DTOS(SODAT)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SORECTYP` | C1 | 100 |  | 0, 5 | doc_header.express_rectype |
| `SONUM` | C12 | 100 | เลขที่ใบสั่งขายที่อ้างถึง | SO0098405, SO0098654, SO00100158 | doc_line.header_id |
| `SEQNUM` | C3 | 100 | ลำดับบรรทัด |   1,   2,   3 | doc_line.line_no |
| `SODAT` | D8 | 100 |  | 20100628, 20100802, 20101222 | (ซ้ำกับหัวเอกสาร) |
| `DLVDAT` | D8 | 100 |  | 20100420, 20100215, 20090501 | doc_line.delivery_date |
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | R-RICE, L-LAU, F-FIRT RET | (ซ้ำกับหัวเอกสาร) |
| `STKCOD` | C20 | 100 | รหัสสินค้า | MELPL-XCGC, MELPL-XCIC, HSFBX-12XC | doc_line.item_id |
| `LOCCOD` | C4 | 100 | รหัสคลัง | HO | doc_line.warehouse_id |
| `STKDES` | C50 | 100 | ชื่อสินค้า |  | doc_line.description |
| `DEPCOD` | C4 | 6 | แผนก | MKT | doc_line.department_id |
| `VATCOD` | C1 | 0 | ประเภท VAT รายบรรทัด |  | doc_line.vat_code |
| `FREE` | C1 | 0 | ของแถม | Y | doc_line.is_free |
| `ORDQTY` | B8.4 | 100 |  | 1296.0, 648.0, 1200.0 | doc_line.qty |
| `CANCELQTY` | B8.4 | 0 |  | 2.0 | doc_line.cancelled_qty |
| `CANCELTYP` | C2 | 0 |  | 02 | doc_line.cancel_reason_code |
| `CANCELDAT` | D8 | 0 |  | 20081112 | doc_line.cancel_date |
| `REMQTY` | B8.4 | 32 |  | 6.0, 1.0 | doc_line.remaining_qty |
| `TFACTOR` | B8.4 | 100 | ตัวคูณ | 1.0, 4.95, 185.98 | doc_line.factor |
| `UNITPR` | B8.4 | 100 | ราคาต่อหน่วย | 43.75, 20.5, 31.25 | doc_line.unit_price |
| `TQUCOD` | C2 | 100 | หน่วย | PC, ST, MT | doc_line.unit_id |
| `DISC` | C10 | 0 | สูตรส่วนลด |        10%,       2.20 | doc_line.discount_text |
| `DISCAMT` | B8.2 | 0 | ส่วนลด | 0.5, 2.2 | doc_line.discount_amount |
| `TRNVAL` | B8.2 | 100 | จำนวนเงิน | 27300.0, 50184.0, 28350.0 | doc_line.line_amount |
| `PACKING` | C15 | 0 |  |  | doc_line.packing |

## POPR — หัวใบสั่งซื้อ/ใบสั่งงาน
ระเบียน 4,003 · ความยาวระเบียน 295 byte  
คีย์ (จาก .CDX): `PONUM` · `SUPCOD+DOCSTAT+PONUM` · `PORECTYP+PONUM` · `DTOS(PODAT)` · `SUPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `PORECTYP` | C1 | 100 |  | 0 | doc_header.express_rectype |
| `PONUM` | C12 | 100 | เลขที่ใบสั่งซื้อที่อ้างถึง | PO0000002, PO0000003, PO0000004 | doc_header.doc_no |
| `PODAT` | D8 | 100 |  | 20091225, 20090317, 20081006 | doc_header.doc_date |
| `FLGVAT` | C1 | 100 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 2, 0, 1 | doc_header.price_type |
| `DEPCOD` | C4 | 11 | แผนก | PDT, BOX | doc_header.department_id |
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | K-KUL, T-TOY_CR, D-DEN | doc_header.supplier_id |
| `SHIPTO` | C10 | 0 | สถานที่ส่งของ |  | doc_header.ship_to_id |
| `YOUREF` | C30 | 99 | อ้างอิง |  | doc_header.your_ref |
| `RFF` | C12 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PAYTRM` | N3 | 46 | เครดิต (วัน) | 30.0, 7.0 | doc_header.credit_days |
| `RCVDAT` | D8 | 99 |  | 20090430, 20091028 | doc_header.delivery_date |
| `RCVTIM` | C4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `RCVDAT_IT` | C1 | 2 |  | Y, N | doc_header.delivery_date_per_line |
| `DLVBY` | C2 | 1 | ขนส่งโดย | 01, บท | doc_header.ship_via_code |
| `NXTSEQ` | C3 | 100 | ลำดับบรรทัดถัดไป (-1 = เอกสารยกเลิก) |   1,   2,   3 | (ใช้ภายใน: ลำดับบรรทัดถัดไป / -1 = ยกเลิก — ไม่ต้องเก็บ) |
| `AMOUNT` | B8.2 | 100 | จำนวนเงิน | 1200.0, 3000.0, 2400.0 | doc_header.amount |
| `DISC` | C10 | 0 | สูตรส่วนลด |        20%,        40% | doc_header.discount_text |
| `DISCAMT` | B8.2 | 0 | ส่วนลด | 1530.0, 5686.0 | doc_header.discount_amount |
| `TOTAL` | B8.2 | 100 | มูลค่าก่อน VAT | 1200.0, 3000.0, 2400.0 | doc_header.taxable_amount |
| `AMTRAT0` | B8.2 | 0 | มูลค่าอัตรา 0% |  | doc_header.zero_rate_amount |
| `VATRAT` | N5.2 | 61 | อัตรา VAT | 7.0 | doc_header.vat_rate |
| `VATAMT` | B8.2 | 60 | ภาษีมูลค่าเพิ่ม | 105.0, 210.0 | doc_header.vat_amount |
| `NETAMT` | B8.2 | 100 | ยอดสุทธิ | 1200.0, 300.0 | doc_header.net_amount |
| `NETVAL` | B8.2 | 100 | มูลค่าสุทธิ | 3000.0, 1500.0, 2400.0 | doc_header.taxable_amount |
| `CMPLDAT` | D8 | 75 | วันที่ครบ | 20101224, 20100830 | doc_header.settled_date |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | M, N, C | doc_header.doc_status |
| `PLACE1` | C50 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | NUT, POOK, EM | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20091225, 20100412, 20090317 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 85 | ผู้พิมพ์ | NUT, EM, POOK | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 85 | วันที่พิมพ์ | 20090714, 20100601 | last_printed_at |
| `PRNCNT` | N2 | 85 | จำนวนครั้งที่พิมพ์ | 1.0, 2.0 | doc_header.print_count |
| `PRNTIM` | C5 | 85 | เวลาพิมพ์ | 17:48, 14:58 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน | NUT | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ | 20080423, 20080211 | doc_header.approved_by |

## POPRIT — รายการใบสั่งซื้อ
ระเบียน 19,290 · ความยาวระเบียน 208 byte  
คีย์ (จาก .CDX): `PONUM+SEQNUM` · `STKCOD+LOCCOD` · `DTOS(RCVDAT)` · `STKCOD` · `PONUM+STKCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `PORECTYP` | C1 | 100 |  | 0 | doc_header.express_rectype |
| `PONUM` | C12 | 100 | เลขที่ใบสั่งซื้อที่อ้างถึง | PO0003591, PO0003951, PO0001775 | doc_line.header_id |
| `SEQNUM` | C3 | 100 | ลำดับบรรทัด |   1,   2,   3 | doc_line.line_no |
| `RCVDAT` | D8 | 99 |  | 20090925, 20090430 | doc_line.delivery_date |
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | S-SRITHAI, K-KUL, T-TOY_CR | (ซ้ำกับหัวเอกสาร) |
| `STKCOD` | C20 | 100 | รหัสสินค้า | AC-AC, AC-DS-ACC, AC-PR-FB | doc_line.item_id |
| `LOCCOD` | C4 | 100 | รหัสคลัง | HO, BX, PK | doc_line.warehouse_id |
| `STKDES` | C50 | 100 | ชื่อสินค้า |  | doc_line.description |
| `DEPCOD` | C4 | 9 | แผนก | PDT, DSN | doc_line.department_id |
| `VATCOD` | C1 | 0 | ประเภท VAT รายบรรทัด |  | doc_line.vat_code |
| `FREE` | C1 | 0 | ของแถม | Y | doc_line.is_free |
| `ORDQTY` | B8.4 | 100 |  | 1.0, 2.0, 10.0 | doc_line.ordered_qty; doc_line.qty |
| `CANCELQTY` | B8.4 | 2 |  | 1.0, 5.0 | doc_line.cancelled_qty |
| `CANCELTYP` | C2 | 2 |  | 02, 03 | doc_line.cancel_reason_code |
| `CANCELDAT` | D8 | 2 |  | 20090520, 20090512 | doc_line.cancel_date |
| `REMQTY` | B8.4 | 16 |  | 1.0, 2.0 | doc_line.remaining_qty |
| `TFACTOR` | B8.4 | 100 | ตัวคูณ | 1.0, 10.0 | doc_line.factor |
| `UNITPR` | B8.4 | 100 | ราคาต่อหน่วย | 25.0, 35.0, 40.0 | doc_line.unit_price |
| `TQUCOD` | C2 | 100 | หน่วย | PC, MT, ST | doc_line.unit_id |
| `DISC` | C10 | 7 | สูตรส่วนลด |       0.08,       0.16 | doc_line.discount_text |
| `DISCAMT` | B8.2 | 7 | ส่วนลด | 0.08, 0.01 | doc_line.discount_amount |
| `TRNVAL` | B8.2 | 100 | จำนวนเงิน | 100.0, 200.0, 300.0 | doc_line.line_amount |
| `PACKING` | C15 | 0 |  |  | doc_line.packing |

## ARTRN — หัวเอกสารระบบขาย/ลูกหนี้ทุกชนิด (แยกด้วย RECTYP)
ระเบียน 2,267 · ความยาวระเบียน 412 byte  
คีย์ (จาก .CDX): `DOCNUM` · `RECTYP+DOCNUM` · `RECTYP+CUSCOD+CMPLAPP+DTOS(DUEDAT)+DOCNUM` · `BILNUM+DOCNUM` FOR `.NOT.DELETED() .AND. BILNUM # '~'` · `DTOS(DOCDAT)+DOCNUM` · `RECTYP+CUSCOD+DTOS(DOCDAT)+DOCNUM` · `RECTYP+DOCNUM` FOR `.NOT.DELETED().AND.NXTSEQ=' -1'` · `CUSCOD+DTOS(DOCDAT)+RECTYP+DOCNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RECTYP` | C1 | 100 | ประเภทรายการ (ดูตารางรหัส) | 3, 9, 0 | doc_header.express_rectype |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | TI5101GGS001, TI5101GGS002, TI5101GGS003 | doc_header.doc_no |
| `DOCDAT` | D8 | 100 | วันที่เอกสาร | 20100531, 20100430, 20100630 | doc_header.doc_date |
| `POSTGL` | C1 | 13 | ลงบัญชีแล้ว Y/N | Y, N | doc_header.gl_posted |
| `SONUM` | C12 | 15 | เลขที่ใบสั่งขายที่อ้างถึง | SO0099687, SO0098405 | doc_header.doc_no |
| `CNTYP` | C1 | 2 | ชนิดใบลดหนี้ | 2, 3 | doc_header.express_rectype + md_doc_type (ชนิดใบลดหนี้) |
| `DEPCOD` | C4 | 0 | แผนก | MKT, GIN | doc_header.department_id |
| `FLGVAT` | C1 | 89 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 2, 1 | doc_header.price_type |
| `SLMCOD` | C10 | 24 | พนักงานขาย | DAN, NP | doc_header.salesperson_id |
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | G-GGS1, R-RICE, L-LAU | doc_header.customer_id |
| `SHIPTO` | C10 | 0 | สถานที่ส่งของ | 001 | doc_header.ship_to_id |
| `YOUREF` | C30 | 71 | อ้างอิง |  | doc_header.your_ref |
| `AREACOD` | C4 | 11 | เขตการขาย | 00, UK | doc_header.sales_area_code |
| `PAYTRM` | N3 | 75 | เครดิต (วัน) | 60.0, 15.0 | doc_header.credit_days |
| `DUEDAT` | D8 | 100 | วันครบกำหนด | 20100831, 20100730, 20100515 | doc_header.due_date |
| `BILNUM` | C12 | 100 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) | ~, BI0000259, BI0000142 | doc_header.doc_no |
| `NXTSEQ` | C3 | 86 | ลำดับบรรทัดถัดไป (-1 = เอกสารยกเลิก) |   1,  -1 | (ใช้ภายใน: ลำดับบรรทัดถัดไป / -1 = ยกเลิก — ไม่ต้องเก็บ) |
| `AMOUNT` | B8.2 | 87 | จำนวนเงิน | 8000.0, 20000.0 | doc_header.amount |
| `DISC` | C10 | 0 | สูตรส่วนลด |       0.13 | doc_header.discount_text |
| `DISCAMT` | B8.2 | 0 | ส่วนลด | 0.13 | doc_header.discount_amount |
| `AFTDISC` | B8.2 | 87 | หลังหักส่วนลด | 8000.0, 20000.0 | doc_header.amount_after_discount |
| `ADVNUM` | C12 | 48 | เลขที่มัดจำที่หัก | AI, AI37/3662 | doc_link (link_type=DEPOSIT) |
| `ADVAMT` | B8.2 | 1 | ยอดมัดจำที่หัก | 111600.0, 24800.0 | doc_header.deposit_amount |
| `TOTAL` | B8.2 | 88 | มูลค่าก่อน VAT | 19250.0, 8000.0 | doc_header.taxable_amount |
| `AMTRAT0` | B8.2 | 0 | มูลค่าอัตรา 0% | 26003.5, 4610.0 | doc_header.zero_rate_amount |
| `VATRAT` | N5.2 | 56 | อัตรา VAT | 7.0 | doc_header.vat_rate |
| `VATAMT` | B8.2 | 56 | ภาษีมูลค่าเพิ่ม | 1347.5, 560.0 | doc_header.vat_amount |
| `NETAMT` | B8.2 | 99 | ยอดสุทธิ | 20597.5, 8560.0 | doc_header.net_amount |
| `NETVAL` | B8.2 | 88 | มูลค่าสุทธิ | 19250.0, 8000.0 | doc_header.taxable_amount |
| `RCVAMT` | B8.2 | 59 | ยอดรับชำระแล้ว | 8560.0, 20597.5 | doc_header.settled_amount |
| `REMAMT` | B8.2 | 31 | ยอดคงค้าง | 21400.0, 9630.0 | doc_header.outstanding_amount |
| `COMAMT` | B8.2 | 0 | ค่าคอมมิชชั่น |  | doc_header.commission_amount |
| `CMPLAPP` | C1 | 100 | ครบแล้ว Y/N | Y, N | doc_header.is_settled |
| `CMPLDAT` | D8 | 66 | วันที่ครบ | 20100205, 20100219 | doc_header.settled_date |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, M, C | doc_header.doc_status |
| `CSHRCV` | B8.2 | 0 | รับเงินสด | 137058.48, 2568.0 | doc_header.cash_amount |
| `CHQRCV` | B8.2 | 15 | รับเป็นเช็ค/อื่น | 20597.5, 117700.0 | doc_header.cheque_amount |
| `INTRCV` | B8.2 | 0 | ดอกเบี้ยรับ |  | doc_header.interest_amount |
| `BEFTAX` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `TAXRAT` | N5.2 | 0 | อัตราภาษีหัก ณ ที่จ่าย |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `TAXCOND` | C1 | 0 | เงื่อนไขการหัก |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `TAX` | B8.2 | 0 | ภาษีหัก ณ ที่จ่าย | 474.0, 30.0 | doc_header.wht_amount |
| `IVCAMT` | B8.2 | 15 | ยอดตามใบกำกับ | 20597.5, 117700.0 | (ยอดตามใบกำกับในใบเสร็จ = Σ doc_settlement.amount) |
| `CHQPAS` | B8.2 | 5 | ยอดเช็คผ่าน | 20597.5, 500000.0 | (คำนวณ: fin_cheque ที่ผ่านแล้ว) |
| `VATDAT` | D8 | 84 | วันที่ใบกำกับภาษี | 20100531, 20100816 | doc_header.vat_date |
| `VATPRD` | D8 | 0 | งวดภาษีที่ยื่น |  | doc_header.vat_period_id |
| `VATLATE` | C1 | 0 | ยื่นเพิ่มเติม |  | doc_header.vat_late |
| `SRV_VATTYP` | C1 | 100 | เกณฑ์ภาษีบริการ 1=สิทธิ 2=เงินสด | 1, -, 2 | doc_header.vat_basis |
| `DLVBY` | C2 | 4 | ขนส่งโดย | 01, 05 | doc_header.ship_via_code |
| `RESERVE` | D8 | 56 |  | 20100205, 20100219 | (ใช้ภายในโปรแกรม — ไม่ย้าย) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, WASUNAN, NING | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20091110, 20091026, 20100222 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 0 | ผู้พิมพ์ | TS, NING | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 0 | วันที่พิมพ์ | 20080916, 20081008 | last_printed_at |
| `PRNCNT` | N2 | 0 | จำนวนครั้งที่พิมพ์ | 1.0 | doc_header.print_count |
| `PRNTIM` | C8 | 0 | เวลาพิมพ์ | 11:42:34, 10:56:07 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | doc_header.approved_by |

## APTRN — หัวเอกสารระบบซื้อ/เจ้าหนี้ทุกชนิด (แยกด้วย RECTYP)
ระเบียน 13,975 · ความยาวระเบียน 394 byte  
คีย์ (จาก .CDX): `DOCNUM` · `RECTYP+DOCNUM` · `RECTYP+SUPCOD+CMPLAPP+DTOS(DUEDAT)+DOCNUM` · `BILNUM+DOCNUM` FOR `.NOT.DELETED() .AND. BILNUM # '~'` · `DTOS(DOCDAT)+DOCNUM` · `RECTYP+SUPCOD+DTOS(DOCDAT)+DOCNUM` · `RECTYP+DOCNUM` FOR `.NOT.DELETED().AND.NXTSEQ=' -1'` · `SUPCOD+DTOS(DOCDAT)+RECTYP+DOCNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RECTYP` | C1 | 100 | ประเภทรายการ (ดูตารางรหัส) | 3, 1, 9 | doc_header.doc_class; doc_header.express_rectype |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | AE0000001, RRBI08A0342, RR80/3978 | doc_header.doc_no |
| `DOCDAT` | D8 | 100 | วันที่เอกสาร | 20090904, 20101015, 20100702 | doc_header.doc_date |
| `REFNUM` | C15 | 51 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | 074/03671, 069/03424 | doc_header.ref_no |
| `VATPRD` | D8 | 70 | งวดภาษีที่ยื่น | 20100301, 20090601 | doc_header.vat_period_id |
| `VATLATE` | C1 | 0 | ยื่นเพิ่มเติม | Y | doc_header.vat_late |
| `VATTYP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `POSTGL` | C1 | 12 | ลงบัญชีแล้ว Y/N | Y, N | doc_header.gl_posted |
| `PONUM` | C12 | 34 | เลขที่ใบสั่งซื้อที่อ้างถึง | PO..., PO0003244 | doc_header.doc_no |
| `DNTYP` | C1 | 0 | ชนิดใบลดหนี้ (ซื้อ) | 2 | doc_header.express_rectype + md_doc_type |
| `DEPCOD` | C4 | 12 | แผนก | PUR, EXH | doc_header.department_id |
| `FLGVAT` | C1 | 91 | ประเภทราคา 0=ไม่มี VAT 1=รวม 2=แยก | 0, 2, 1 | doc_header.price_type |
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | S-SRITHAI, K-KUL, D-DHL | doc_header.supplier_id |
| `SHIPTO` | C10 | 0 | สถานที่ส่งของ |  | doc_header.ship_to_id |
| `YOUREF` | C30 | 70 | อ้างอิง |  | doc_header.your_ref |
| `PAYTRM` | N3 | 29 | เครดิต (วัน) | 30.0 | doc_header.credit_days |
| `DUEDAT` | D8 | 100 | วันครบกำหนด | 20090904, 20101015, 20101119 | doc_header.due_date |
| `BILNUM` | C12 | 100 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) | ~, BR0000258, BR0000048 | doc_header.doc_no |
| `DLVBY` | C2 | 0 | ขนส่งโดย | 01, บท | doc_header.ship_via_code |
| `NXTSEQ` | C3 | 87 | ลำดับบรรทัดถัดไป (-1 = เอกสารยกเลิก) |   1,   2 | (ใช้ภายใน: ลำดับบรรทัดถัดไป / -1 = ยกเลิก — ไม่ต้องเก็บ) |
| `AMOUNT` | B8.2 | 86 | จำนวนเงิน | 200.0, 500.0 | doc_header.amount |
| `DISC` | C10 | 0 | สูตรส่วนลด |      10.00,       2.00 | doc_header.discount_text |
| `DISCAMT` | B8.2 | 0 | ส่วนลด | 10.0, 2.0 | doc_header.discount_amount |
| `AFTDISC` | B8.2 | 86 | หลังหักส่วนลด | 200.0, 500.0 | doc_header.amount_after_discount |
| `ADVNUM` | C12 | 24 | เลขที่มัดจำที่หัก | AE, AE... | doc_link (link_type=DEPOSIT) |
| `ADVAMT` | B8.2 | 4 | ยอดมัดจำที่หัก | 10000.0, 3000.0 | doc_header.deposit_amount |
| `TOTAL` | B8.2 | 87 | มูลค่าก่อน VAT | 200.0, 500.0 | doc_header.taxable_amount |
| `AMTRAT0` | B8.2 | 0 | มูลค่าอัตรา 0% | 100.0, 1100.0 | doc_header.zero_rate_amount |
| `VATRAT` | N5.2 | 43 | อัตรา VAT | 7.0 | doc_header.vat_rate |
| `VATAMT` | B8.2 | 41 | ภาษีมูลค่าเพิ่ม | 32.71, 14.0 | doc_header.vat_amount |
| `NETAMT` | B8.2 | 96 | ยอดสุทธิ | 500.0, 1000.0 | doc_header.net_amount |
| `NETVAL` | B8.2 | 87 | มูลค่าสุทธิ | 200.0, 467.29 | doc_header.taxable_amount |
| `PAYAMT` | B8.2 | 93 | ยอดจ่ายชำระแล้ว | 500.0, 1000.0 | doc_header.settled_amount |
| `REMAMT` | B8.2 | 5 | ยอดคงค้าง | 20000.0, 10000.0 | doc_header.outstanding_amount |
| `CMPLAPP` | C1 | 100 | ครบแล้ว Y/N | Y, N | doc_header.is_settled |
| `CMPLDAT` | D8 | 97 | วันที่ครบ | 20101015, 20100702 | doc_header.settled_date |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, M, C | doc_header.doc_status |
| `CSHPAY` | B8.2 | 33 | จ่ายเงินสด | 500.0, 1000.0 | doc_header.cash_amount |
| `CHQPAY` | B8.2 | 29 | จ่ายเป็นเช็ค/อื่น | 11000.0, 10000.0 | doc_header.cheque_amount |
| `INTPAY` | B8.2 | 0 | ดอกเบี้ยจ่าย | 0.55, 0.63 | doc_header.interest_amount |
| `TAX` | B8.2 | 0 | ภาษีหัก ณ ที่จ่าย | 686.88, 632.87 | doc_header.wht_amount |
| `RCVAMT` | B8.2 | 15 | ยอดรับชำระแล้ว | 24498.72, 1070.0 | doc_header.settled_amount |
| `CHQPAS` | B8.2 | 29 | ยอดเช็คผ่าน | 11000.0, 10000.0 | (คำนวณ: fin_cheque ที่ผ่านแล้ว) |
| `VATDAT` | D8 | 82 | วันที่ใบกำกับภาษี | 20090605, 20101130 | doc_header.vat_date |
| `SRV_VATTYP` | C1 | 100 | เกณฑ์ภาษีบริการ 1=สิทธิ 2=เงินสด | -, 1, 2 | doc_header.vat_basis |
| `PVATPRORAT` | C1 | 100 |  | - | sys_setting tax.input_vat_prorate |
| `PVAT_RF` | N6.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PVAT_NRF` | N6.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, OIL, JIB | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20100720, 20101012, 20101013 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 3 | ผู้พิมพ์ | PLEACC, OIL | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 3 | วันที่พิมพ์ | 20101221, 20101123 | last_printed_at |
| `PRNCNT` | N2 | 3 | จำนวนครั้งที่พิมพ์ | 1.0, 2.0 | doc_header.print_count |
| `PRNTIM` | C5 | 3 | เวลาพิมพ์ | 10:15, 14:12 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน | NUT | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ | 20100212 | doc_header.approved_by |

## STTRN — หัวเอกสารระบบสินค้า (เบิก โอน ปรับปรุง)
ระเบียน 3,647 · ความยาวระเบียน 211 byte  
คีย์ (จาก .CDX): `DOCNUM` · `POSOPR+DTOS(DOCDAT)+DOCNUM` · `DTOS(DOCDAT)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | OB0000001, OB0000002, RL0000016 | doc_header.doc_no |
| `DOCDAT` | D8 | 100 | วันที่เอกสาร | 20091125, 20100419, 20100915 | doc_header.doc_date |
| `POSOPR` | C1 | 100 | รหัสการเคลื่อนไหวสต๊อก (ดูตารางรหัส) | 4, 6, 8 | doc_header.doc_class |
| `PEOPLE` | C10 | 53 | คู่ค้า/คลังปลายทาง | GG, PK | doc_header.to_warehouse_id |
| `REMARK` | C50 | 77 |  |  | doc_header.remark |
| `LOCCOD` | C4 | 100 | รหัสคลัง | SW, HO, PK | doc_header.warehouse_id |
| `TRNVAL` | B8.2 | 89 | จำนวนเงิน | 103680.0, 7200.0 | doc_header.net_amount |
| `REFNUM` | C15 | 0 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า |  | doc_header.ref_no |
| `REFDAT` | D8 | 0 |  |  | doc_header.ref_date |
| `NXTSEQ` | C3 | 98 | ลำดับบรรทัดถัดไป (-1 = เอกสารยกเลิก) |   1,   2,   3 | (ใช้ภายใน: ลำดับบรรทัดถัดไป / -1 = ยกเลิก — ไม่ต้องเก็บ) |
| `ACCNUMDR` | C15 | 13 | บัญชีเดบิตที่ระบุเอง | 1140-03, 5200-03 | doc_line.gl_debit_account_id |
| `ACCNUMCR` | C15 | 1 | บัญชีเครดิตที่ระบุเอง | 5110-00 | doc_line.gl_credit_account_id |
| `DEPCOD` | C4 | 91 | แผนก | SEW, PACK, GIN | doc_header.department_id |
| `POSTGL` | C1 | 0 | ลงบัญชีแล้ว Y/N |  | doc_header.gl_posted |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, C | doc_header.doc_status |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | OIL, KING, PLE | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20100523, 20101104, 20100527 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 21 | ผู้พิมพ์ | KOB, KING | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 21 | วันที่พิมพ์ | 20090925, 20090711 | last_printed_at |
| `PRNCNT` | N2 | 21 | จำนวนครั้งที่พิมพ์ | 1.0, 2.0 | doc_header.print_count |
| `PRNTIM` | C5 | 21 | เวลาพิมพ์ | 17:06, 11:08 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | doc_header.approved_by |

## STCRD — สต๊อกการ์ด = บรรทัดรายการของทุกเอกสาร
ระเบียน 106,954 · ความยาวระเบียน 417 byte  
คีย์ (จาก .CDX): `STKCOD+DTOS(DOCDAT)+POSOPR+DOCNUM+SEQNUM` FOR `.NOT.DELETED().AND.POSOPR <> ' '` · `STKCOD+LOCCOD+DTOS(DOCDAT)+POSOPR+DOCNUM+SEQNUM` FOR `.NOT.DELETED().AND.POSOPR <> ' '` · `DOCNUM+SEQNUM` · `STKCOD+SUBSTR(DOCNUM,1,2)+DTOS(DOCDAT)+DOCNUM` · `DOCNUM+SEQNUM` FOR `.NOT.DELETED().AND.PSTKCOD = ' '` · `DTOS(DOCDAT)+STKCOD` · `PEOPLE+STKCOD+SUBSTR(DOCNUM,1,2)+DTOS(DOCDAT)` · `STKCOD+DTOS(DOCDAT)+POSOPR+DOCNUM+SEQNUM` FOR `.NOT.DELETED().AND.(POSOPR < '4'.OR.POSOPR=':')`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 99 | รหัสสินค้า | EX-5310-13, EX-5200-10, EX-5150-01 | doc_line.item_id; inv_stock_ledger.item_id |
| `LOCCOD` | C4 | 100 | รหัสคลัง | HO, SW, GG | doc_line.warehouse_id; inv_stock_ledger.warehouse_id |
| `DOCNUM` | C12 | 98 | เลขที่เอกสาร | TK0000014, TK0000015 | doc_line.header_id |
| `SEQNUM` | C3 | 100 | ลำดับบรรทัด |   1,   2,   3 | doc_line.line_no |
| `DOCDAT` | D8 | 99 | วันที่เอกสาร | 20081231, 20100915 | inv_stock_ledger.txn_date |
| `RDOCNUM` | C15 | 23 | เอกสาร/บรรทัดต้นทางที่อ้างถึง | STNPR,               1 | doc_line.source_line_id |
| `REFNUM` | C15 | 17 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | 069/03424, 069/03423 | doc_header.ref_no |
| `DEPCOD` | C4 | 54 | แผนก | SEW, PACK | doc_line.department_id |
| `POSOPR` | C1 | 99 | รหัสการเคลื่อนไหวสต๊อก (ดูตารางรหัส) | 0, 6, 9 | doc_line.movement_code; inv_stock_ledger.movement_code |
| `FREE` | C1 | 0 | ของแถม | Y, . | doc_line.is_free |
| `VATCOD` | C1 | 0 | ประเภท VAT รายบรรทัด | 0 | doc_line.vat_code |
| `PEOPLE` | C10 | 73 | คู่ค้า/คลังปลายทาง | HO, G-GGS1 | doc_line.party_customer_id; doc_line.party_supplier_id |
| `SLMCOD` | C10 | 5 | พนักงานขาย | DAN, NP | doc_line.salesperson_id |
| `FLAG` | C1 | 1 | สถานะบรรทัด | 5, 2 | (ใช้ภายใน: สถานะตรวจนับ → inv_stock_count.flag) |
| `TRNQTY` | B8.4 | 96 | จำนวน | 1.0, 2.0, 4.0 | doc_line.qty |
| `TQUCOD` | C2 | 95 | หน่วย | PC, MT, BT | doc_line.unit_id |
| `TFACTOR` | B8.4 | 96 | ตัวคูณ | 1.0, 10.0 | doc_line.factor |
| `UNITPR` | B8.4 | 87 | ราคาต่อหน่วย | 25.0, 100.0 | doc_line.unit_price |
| `DISC` | C10 | 2 | สูตรส่วนลด |       0.08,       0.01 | doc_line.discount_text |
| `DISCAMT` | B8.2 | 2 | ส่วนลด | 0.08, 0.01 | doc_line.discount_amount |
| `TRNVAL` | B8.2 | 91 | จำนวนเงิน | 100.0, 300.0 | doc_line.line_amount |
| `PHYBAL` | B8.4 | 1 | ยอดตรวจนับ | 1.0, 10.0 | inv_stock_count.counted_qty |
| `RETSTK` | C1 | 0 | คืนเข้าสต๊อก Y/N | N, Y | doc_line.return_to_stock |
| `XTRNQTY` | B8.4 | 96 | จำนวน (หน่วยหลัก) | 1.0, 2.0, 4.0 | doc_line.base_qty; inv_stock_ledger.qty |
| `XUNITPR` | B8.4 | 83 | ต้นทุนต่อหน่วย | 35.0, 25.0 | doc_line.cost_unit; inv_stock_ledger.unit_cost |
| `XTRNVAL` | B8.2 | 86 | มูลค่าต้นทุน | 500.0, 300.0 | doc_line.cost_amount; inv_stock_ledger.value |
| `XSALVAL` | B8.2 | 25 | มูลค่าขาย | 300.0, 100.0 | doc_line.sales_value |
| `NETVAL` | B8.2 | 73 | มูลค่าสุทธิ | 300.0, 150.0 | doc_line.net_amount |
| `MLOTNUM` | C24 | 88 | ล็อต FIFO (วันที่+เอกสาร+ลำดับที่รับเข้า) |         1              1, - | inv_cost_consumption → inv_cost_layer |
| `MREMBAL` | B8.4 | 64 | คงเหลือในล็อต | 1.0, 2.0 | inv_cost_layer.qty_remaining / value_remaining |
| `MREMVAL` | B8.2 | 57 | มูลค่าคงเหลือในล็อต | 150.0, 600.0 | inv_cost_layer.qty_remaining / value_remaining |
| `BALCHG` | B8.4 | 0 |  | 10.0, -140.0 | (ปรับยอดตรวจนับ → inv_stock_count.diff_qty) |
| `VALCHG` | B8.2 | 0 |  | 1294.04, -231.0 | (ปรับมูลค่า → doc_line.cost_amount) |
| `LOTBAL` | B8.4 | 43 | ยอดล็อต | 1.0, 2.0 | (inv_cost_layer) |
| `LOTVAL` | B8.2 | 38 | มูลค่าล็อต | 300.0, 93.46 | (inv_cost_layer) |
| `LUNITPR` | B8.4 | 38 | ต้นทุนล็อต/หน่วย | 35.0, 25.0 | (inv_cost_layer) |
| `PSTKCOD` | C20 | 0 | สินค้าชุดแม่ |  | (สินค้าชุดแม่ — md_item_bom) |
| `ACCNUMDR` | C15 | 11 | บัญชีเดบิตที่ระบุเอง | 1140-03, 5200-03 | doc_line.gl_debit_account_id |
| `ACCNUMCR` | C15 | 0 | บัญชีเครดิตที่ระบุเอง | 5110-00 | doc_line.gl_credit_account_id |
| `STKDES` | C50 | 97 | ชื่อสินค้า |  | doc_line.description |
| `PACKING` | C15 | 0 |  |  | doc_line.packing |
| `JOBCOD` | C6 | 0 | โครงการ |  | doc_line.project_id |
| `PHASE` | C4 | 0 | ขั้นตอน |  | doc_line.project_phase |
| `COSCOD` | C4 | 0 | รหัสต้นทุน |  | doc_line.cost_code |
| `REIMBURSE` | C1 | 30 | สถานะเบิกชดเชย | 9, i | doc_line.reimburse_flag |

## ARTRNRM — หมายเหตุเพิ่มเติมของเอกสาร/สินค้า/ผู้จำหน่าย
ระเบียน 6,552 · ความยาวระเบียน 71 byte  
คีย์ (จาก .CDX): `DOCNUM+SEQNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | PO0000235, PO0001309, PO0002145 | doc_note.header_id |
| `SEQNUM` | C8 | 90 | ลำดับบรรทัด |   1, @1,   2 | doc_note.line_id |
| `REMARK` | C50 | 83 |  |  | doc_note.text; md_note.text |

## ARBIL — ใบวางบิล (ลูกหนี้)
ระเบียน 249 · ความยาวระเบียน 190 byte  
คีย์ (จาก .CDX): `BILNUM` · `DTOS(APPDAT)+BILNUM` FOR `.NOT.DELETED().AND.DTOS(APPDAT)='        '` · `DTOS(BILDAT)+BILNUM` · `DTOS(BILOUT)+CUSCOD+BILNUM` · `DTOS(APPDAT)+CUSCOD+BILNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BILNUM` | C12 | 100 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) | BI0000003, BI0000004, BI0000005 | doc_header.doc_no |
| `BILDAT` | D8 | 100 |  | 20101215, 20101001, 20101112 | doc_header.doc_date |
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | G-GGS1, R-RICE, THE-HOUSE | doc_header.customer_id |
| `DEPCOD` | C4 | 0 | แผนก |  | doc_header.department_id |
| `BILOUT` | D8 | 100 |  | 20101215, 20101001, 20101112 | doc_header.doc_date (วันที่ออกวางบิล) |
| `APPDAT` | D8 | 1 |  | 20090306, 20090419 | doc_header.appointment_date |
| `PAYCOND` | C25 | 3 |  | Account fee 5/53, ชำระเงินก่อนส่งของ | doc_header.payment_terms |
| `REMARK` | C50 | 41 |  |  | doc_header.remark |
| `NETAMT` | B8.2 | 99 | ยอดสุทธิ | 8560.0, 20597.5, 9630.0 | doc_header.net_amount |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, C | doc_header.doc_status |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, NING, WASUNAN | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20101215, 20101015, 20101112 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 6 | ผู้พิมพ์ | NING, AOM | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 6 | วันที่พิมพ์ | 20101015, 20100617 | last_printed_at |
| `PRNCNT` | N2 | 6 | จำนวนครั้งที่พิมพ์ | 1.0, 4.0 | doc_header.print_count |
| `PRNTIM` | C5 | 6 | เวลาพิมพ์ | 10:18, 14:27 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | doc_header.approved_by |

## ARBILIT — รายการในใบวางบิล (ไม่ได้ใช้ ใช้ ARTRN.BILNUM แทน)
ระเบียน 0 · ความยาวระเบียน 41 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BILNUM` | C12 | 0 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DOCNUM` | C12 | 0 | เลขที่เอกสาร |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `RCVAMT` | B8.2 | 0 | ยอดรับชำระแล้ว |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VATAMT` | B8.2 | 0 | ภาษีมูลค่าเพิ่ม |  | doc_bill_item.vat_amount |

## APBIL — ใบรับวางบิล
ระเบียน 839 · ความยาวระเบียน 182 byte  
คีย์ (จาก .CDX): `BILNUM` · `DTOS(APPDAT)+SUPCOD+BILNUM` · `DTOS(BILDAT)+BILNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BILNUM` | C12 | 100 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) | BR0000027, BR0000043, BR0000045 | doc_header.doc_no |
| `BILDAT` | D8 | 100 |  | 20100217, 20091105, 20101101 | doc_header.doc_date |
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | H-HANQ, S-SRITHAI, N-NORTHERN | doc_header.supplier_id |
| `DEPCOD` | C4 | 0 | แผนก |  | doc_header.department_id |
| `APPDAT` | D8 | 36 |  | 20101203, 20101119 | doc_header.appointment_date |
| `PAYCOND` | C25 | 34 |  | 30 Days after Billing, Last week of next month | doc_header.payment_terms |
| `REMARK` | C50 | 47 |  |  | doc_header.remark |
| `NETAMT` | B8.2 | 99 | ยอดสุทธิ | 1712.0, 64200.0 | doc_header.net_amount |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, C | doc_header.doc_status |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, JIB, MOOK | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20100217, 20091105, 20091001 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 3 | ผู้พิมพ์ | JIB, PLEACC | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 3 | วันที่พิมพ์ | 20100309, 20081209 | last_printed_at |
| `PRNCNT` | N2 | 3 | จำนวนครั้งที่พิมพ์ | 1.0, 2.0 | doc_header.print_count |
| `PRNTIM` | C5 | 3 | เวลาพิมพ์ | 10:25, 11:47 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | doc_header.auth_user_id |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | doc_header.approved_by |

## APBILIT — รายการในใบรับวางบิล (ไม่ได้ใช้)
ระเบียน 0 · ความยาวระเบียน 41 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BILNUM` | C12 | 0 | เลขที่ใบวางบิล (~ = ยังไม่วางบิล) |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DOCNUM` | C12 | 0 | เลขที่เอกสาร |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PAYAMT` | B8.2 | 0 | ยอดจ่ายชำระแล้ว |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VATAMT` | B8.2 | 0 | ภาษีมูลค่าเพิ่ม |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## ARRCPIT — รายการตัดชำระของใบเสร็จ (ใบเสร็จ → ใบกำกับ)
ระเบียน 1,390 · ความยาวระเบียน 42 byte  
คีย์ (จาก .CDX): `RCPNUM+DOCNUM` · `DOCNUM+RCPNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RCPNUM` | C12 | 100 | เลขที่ใบเสร็จ/ใบสำคัญจ่าย | REGGS2010003, RE201001003, REGGS2010004 | doc_settlement.payment_header_id; doc_settlement.payment_journal_id |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | TI11TGL001, AI39/3866, TI0802ATD001 | doc_settlement.invoice_header_id |
| `RECTYP` | C1 | 100 | ประเภทรายการ (ดูตารางรหัส) | 3, 0, 5 | doc_settlement.express_rectype |
| `RCVAMT` | B8.2 | 100 | ยอดรับชำระแล้ว | 8560.0, 20597.5, 117700.0 | doc_settlement.amount |
| `VATAMT` | B8.2 | 4 | ภาษีมูลค่าเพิ่ม | 560.0, 1347.5 | doc_settlement.vat_amount |

## ARRCPCQ — วิธีรับเงินของเอกสาร (เงินสด/เช็ค/โอน ฯลฯ)
ระเบียน 646 · ความยาวระเบียน 33 byte  
คีย์ (จาก .CDX): `RCPNUM+CHQNUM` · `CHQNUM+RCPNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RCPNUM` | C12 | 100 | เลขที่ใบเสร็จ/ใบสำคัญจ่าย | RE38/3705, RE38/3737, RE201007005 | doc_payment.header_id |
| `CHQNUM` | C12 | 100 | เลขที่เช็ค / (ใน RCPCQ) รหัสวิธีชำระ 2 ตัว + เลขอ้างอิง | TCREGGS20090, TCREGGS20100, AJRE20100300 | doc_payment.payment_method_id (2 ตัวแรก) + reference_no |
| `RCVAMT` | B8.2 | 100 | ยอดรับชำระแล้ว | 500.0, 200.0, 20597.5 | doc_payment.amount |

## APRCPIT — รายการตัดชำระของใบสำคัญจ่าย
ระเบียน 6,008 · ความยาวระเบียน 42 byte  
คีย์ (จาก .CDX): `RCPNUM+DOCNUM` · `DOCNUM+RCPNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RCPNUM` | C12 | 100 | เลขที่ใบเสร็จ/ใบสำคัญจ่าย | PS124/9856, PS114/8891, PS083/7124 | doc_settlement.payment_header_id; doc_settlement.payment_journal_id |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | AE113/8773, PA090/7475, PA087/7349 | doc_settlement.invoice_header_id |
| `RECTYP` | C1 | 100 | ประเภทรายการ (ดูตารางรหัส) | 3, 0, 5 | doc_settlement.express_rectype |
| `PAYAMT` | B8.2 | 100 | ยอดจ่ายชำระแล้ว | 214.0, 200.0, 10000.0 | doc_settlement.amount |
| `VATAMT` | B8.2 | 17 | ภาษีมูลค่าเพิ่ม | 14.0, 1602.72 | doc_settlement.vat_amount |

## APRCPCQ — วิธีจ่ายเงินของเอกสาร
ระเบียน 7,062 · ความยาวระเบียน 33 byte  
คีย์ (จาก .CDX): `RCPNUM+CHQNUM` · `CHQNUM+RCPNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RCPNUM` | C12 | 100 | เลขที่ใบเสร็จ/ใบสำคัญจ่าย | OE071/6514, PS107/8342, OE121/9535 | doc_payment.header_id |
| `CHQNUM` | C12 | 100 | เลขที่เช็ค / (ใน RCPCQ) รหัสวิธีชำระ 2 ตัว + เลขอ้างอิง | PCOE077/6822, PCOE076/6782, PCOE081/7010 | doc_payment.payment_method_id (2 ตัวแรก) + reference_no |
| `PAYAMT` | B8.2 | 100 | ยอดจ่ายชำระแล้ว | -20.0, -30.0, 0.05 | doc_payment.amount |

## BKTRN — ทะเบียนเช็ครับ/จ่าย และรายการโอน
ระเบียน 1,193 · ความยาวระเบียน 313 byte  
คีย์ (จาก .CDX): `BKTRNTYP+DTOS(CHQDAT)+CHQNUM` · `BKTRNTYP+CUSCOD+CHQNUM` FOR `.NOT.DELETED().AND.CMPLAPP='N'` · `CHQNUM` · `BKTRNTYP+DTOS(CHQDAT)+BNKCOD` FOR `.NOT.DELETED().AND.CHQSTAT='0'` · `BNKACC+DTOS(TRNDAT)+JNLTRNTYP` · `BKTRNTYP+CHQNUM` FOR `.NOT.DELETED().AND.CHQSTAT='0'` · `BKTRNTYP+VOUCHER` · `CUSCOD+CHQSTAT+DTOS(CHQDAT)+CHQNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `BKTRNTYP` | C2 | 100 | ชนิดรายการ QR/QP/bR/bP/BT/Bx | QP, bR, bP | fin_cheque.direction; fin_cheque.instrument |
| `TRNDAT` | D8 | 100 |  | 20100630, 20101213, 20091120 | fin_cheque.pass_date |
| `CHQNUM` | C12 | 100 | เลขที่เช็ค / (ใน RCPCQ) รหัสวิธีชำระ 2 ตัว + เลขอ้างอิง | BT070/6454, BT60/5496, BT072/6556 | doc_payment.cheque_id; fin_cheque.cheque_no |
| `CHQDAT` | D8 | 100 | วันที่เช็ค | 20091106, 20100820, 20091120 | fin_cheque.cheque_date |
| `BNKCOD` | C2 | 35 | ธนาคาร | C1, C3 | fin_cheque.bank_id |
| `BRANCH` | C22 | 0 |  | สาขากรมศุลกากร, ถนนสุขสวัสดิ์ | fin_cheque.bank_branch |
| `CUSCOD` | C10 | 65 | รหัสลูกค้า | R-RICE, B-BBL | fin_cheque.customer_id; fin_cheque.supplier_id |
| `NAME` | C50 | 66 |  |  | fin_cheque.payee_name |
| `DEPCOD` | C4 | 6 | แผนก | EXH, EXT | doc_header.department_id; fin_cheque.department_id |
| `POSTGL` | C1 | 0 | ลงบัญชีแล้ว Y/N |  | doc_header.gl_posted |
| `GETDAT` | D8 | 73 |  | 20090119, 20091106 | fin_cheque.received_date |
| `PAYINDAT` | D8 | 0 |  | 20090422 | fin_cheque.deposit_date |
| `AMOUNT` | B8.2 | 100 | จำนวนเงิน | 200.0, 2000000.0, 1000000.0 | doc_header.amount; fin_cheque.amount |
| `CHARGE` | B8.2 | 7 |  | 200.0, 400.0 | fin_cheque.charge |
| `VATAMT` | B8.2 | 0 | ภาษีมูลค่าเพิ่ม |  | doc_header.vat_amount |
| `NETAMT` | B8.2 | 100 | ยอดสุทธิ | 200.0, 1000000.0, 29093.0 | doc_header.net_amount; fin_cheque.net_amount |
| `REMAMT` | B8.2 | 2 | ยอดคงค้าง | 24738.0, -1.0 | doc_header.outstanding_amount; fin_cheque.remaining_amount |
| `REMCUT` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CMPLAPP` | C1 | 39 | ครบแล้ว Y/N | Y, N | doc_header.is_settled; fin_cheque.is_settled |
| `CHQSTAT` | C2 | 100 | สถานะเช็ค (ISTAB 02) | 10, 19, 00 | fin_cheque.status |
| `BNKACC` | C2 | 100 | บัญชีเงินฝาก | C3, C2, C1 | doc_header.bank_account_id; fin_cheque.bank_account_id |
| `JNLTRNTYP` | C1 | 100 |  | 1, 0 | fin_cheque.direction (0=เข้า 1=ออก) |
| `REMARK` | C50 | 81 |  |  | doc_header.remark; fin_cheque.remark |
| `REFDOC` | C12 | 73 |  | ~ | (ใช้ภายใน: ~ = มีเอกสารอ้างอิง) |
| `REFNUM` | C15 | 0 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | ~ | fin_cheque.remark |
| `VATDAT` | D8 | 0 | วันที่ใบกำกับภาษี |  | doc_header.vat_date |
| `VATPRD` | D8 | 0 | งวดภาษีที่ยื่น |  | doc_header.vat_period_id |
| `VATLATE` | C1 | 0 | ยื่นเพิ่มเติม |  | doc_header.vat_late |
| `VATTYP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VOUCHER` | C12 | 73 | เลขที่ใบสำคัญ | OE071/6514, OE124/9838 | fin_cheque.source_header_id |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, NING, JIB | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20101220, 20100608, 20101108 | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## BKTRNIT — รายการเช็คในใบนำฝาก
ระเบียน 0 · ความยาวระเบียน 33 byte  
คีย์ (จาก .CDX): `DEPNUM+CHQNUM` · `CHQNUM+DEPNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `DEPNUM` | C12 | 0 |  |  | fin_cheque.deposit_header_id |
| `CHQNUM` | C12 | 0 | เลขที่เช็ค / (ใน RCPCQ) รหัสวิธีชำระ 2 ตัว + เลขอ้างอิง |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CHARGE` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLJNL — หัวใบสำคัญ/สมุดรายวัน
ระเบียน 16,765 · ความยาวระเบียน 185 byte  
คีย์ (จาก .CDX): `VOUCHER` · `JNLTYP+VOUCHER` FOR `.NOT.DELETED().AND.TRNSTAT#'U'` · `JNLTYP+VOUCHER` FOR `.NOT.DELETED().AND.TRNSTAT='U'` · `JNLTYP+DTOS(VOUDAT)+VOUCHER` FOR `.NOT.DELETED().AND.TRNSTAT#'U'` · `VOUCHER` FOR `.NOT.DELETED().AND.TRNSTAT='U'` · `DTOS(CHGDAT)+VOUCHER` · `DTOS(VOUDAT)` · `JNLTYP`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `JNLTYP` | C2 | 100 | สมุดรายวัน | 04, 01, 03 | gl_journal.journal_book_id |
| `BATCH` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VOUDAT` | D8 | 100 | วันที่ใบสำคัญ | 20090904, 20100531, 20100702 | gl_journal.voucher_date |
| `VOUCHER` | C12 | 100 | เลขที่ใบสำคัญ | AE070/6468, AE070/6471, AE070/6493 | doc_settlement.payment_journal_id; gl_journal.voucher_no |
| `REFNUM` | C12 | 0 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า |  | gl_journal.reference |
| `SRCJNL` | C4 | 3 | ระบบต้นทาง | GL | gl_journal.source_module |
| `DESCRP` | C50 | 100 | คำอธิบาย |  | gl_journal.description |
| `REVERSE` | C1 | 0 |  |  | gl_journal.reversal_of_id |
| `TRNSTAT` | C1 | 100 | U=ยังไม่ผ่านรายการ | U | gl_journal.status |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, C | gl_journal.doc_status |
| `CREBY` | C8 | 100 | ผู้สร้าง | PLEACC, OIL, NING | (คอลัมน์มาตรฐาน created_by / created_at) |
| `CREDAT` | D8 | 100 | วันที่สร้าง | 20090609, 20100720, 20101013 | (คอลัมน์มาตรฐาน created_by / created_at) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, OIL, NING | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20090808, 20090609, 20100720 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `POSTID` | C8 | 0 |  |  | gl_journal.posted_by |
| `POSDAT` | D8 | 0 |  |  | gl_journal.posted_at |
| `USERPRN` | C8 | 0 | ผู้พิมพ์ | PLEACC | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 0 | วันที่พิมพ์ | 20090203, 20090615 | last_printed_at |
| `PRNCNT` | N2 | 0 | จำนวนครั้งที่พิมพ์ | 1.0 | gl_journal.print_count |
| `PRNTIM` | C5 | 0 | เวลาพิมพ์ | 16:03, 10:28 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | gl_journal.approved_by |

## GLJNLIT — รายการเดบิต/เครดิตของใบสำคัญ
ระเบียน 49,240 · ความยาวระเบียน 148 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `VOUCHER` | C12 | 100 | เลขที่ใบสำคัญ | JV520630011, JV520701001, RV36/3584 | gl_journal_line.journal_id |
| `SEQIT` | C2 | 100 | ลำดับ |  2,  6,  5 | gl_journal_line.line_no |
| `VOUDAT` | D8 | 100 | วันที่ใบสำคัญ | 20100430, 20090904, 20100531 | (ซ้ำกับ gl_journal.voucher_date) |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 2140-00, 1154-01, 2120-01 | gl_journal_line.account_id |
| `DEPCOD` | C4 | 8 | แผนก | EXH, PUR | gl_journal_line.department_id |
| `JOBCOD` | C6 | 0 | โครงการ |  | gl_journal_line.project_id |
| `PHASE` | C4 | 0 | ขั้นตอน |  | gl_journal_line.project_phase |
| `COSCOD` | C4 | 0 | รหัสต้นทุน |  | gl_journal_line.cost_code |
| `DESCRP` | C50 | 100 | คำอธิบาย |  | gl_journal_line.description |
| `TRNTYP` | C1 | 100 | 0=เดบิต 1=เครดิต | 0, 1 | gl_journal_line.debit / credit (0=เดบิต 1=เครดิต) |
| `AMOUNT` | N13.2 | 99 | จำนวนเงิน | 20.0, 30.0 | gl_journal_line.credit; gl_journal_line.debit |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20090609, 20090808, 20100720 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGTIM` | C4 | 100 |  | 1733, 1741, 1722 | updated_at |
| `ADJUST` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CHGACCFROM` | C15 | 0 |  | 1112-02, 2120-01 | gl_journal_line.changed_from_account_id |

## GLPTT — เงินสดย่อย (DP จ่าย / VR เบิกชดเชย)
ระเบียน 136 · ความยาวระเบียน 184 byte  
คีย์ (จาก .CDX): `DOCNUM` · `RECTYP+DOCNUM` · `DTOS(DOCDAT)+DOCNUM` · `REFNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `RECTYP` | C1 | 100 | ประเภทรายการ (ดูตารางรหัส) | 1, 0 | doc_header.express_rectype |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | DP0000010, VR070/6478, DP0000011 | doc_header.doc_no |
| `DOCDAT` | D8 | 100 | วันที่เอกสาร | 20090109, 20090116, 20090130 | doc_header.doc_date |
| `DOCTYP` | C15 | 50 | หมวดเอกสาร | แสงคำ | doc_header.remark (ผู้เบิก) |
| `PTTSTAT` | C2 | 50 |  | 99 | doc_header.doc_status (ISTAB 53: 00 รอเคลียร์ 99 เรียบร้อย) |
| `DOCSTAT` | C1 | 100 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N | doc_header.doc_status |
| `AMOUNT` | N14.2 | 100 | จำนวนเงิน | 59813.5, 44276.5, 48386.75 | doc_header.amount |
| `REMARK` | C50 | 98 |  |  | doc_header.remark |
| `REFNUM` | C12 | 50 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | VR070/6478, VR071/6513 | doc_link (DP → VR) |
| `CHQAMT` | N14.2 | 50 |  | 59813.5, 44276.5 | doc_header.cheque_amount |
| `EXTAMT` | N14.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `EXTDAT` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | PLEACC, JIB, AOM | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20091111, 20100310, 20101027 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `POSTID` | C8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `POSDAT` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLPTTIT — รายการเงินสดย่อย
ระเบียน 2,204 · ความยาวระเบียน 99 byte  
คีย์ (จาก .CDX): `DOCNUM+STR(RECNO(),10,0)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | DP0000068, DP0000070, DP0000071 | doc_line.header_id |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 2140-00 | doc_line.account_id |
| `DEPCOD` | C4 | 0 | แผนก |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DESCRP` | C40 | 100 | คำอธิบาย |  | doc_line.description |
| `AMOUNT` | N13.2 | 100 | จำนวนเงิน | 2000.0, 700.0, 1000.0 | doc_line.line_amount |
| `JOBCOD` | C6 | 0 | โครงการ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PHASE` | C4 | 0 | ขั้นตอน |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `COSCOD` | C4 | 0 | รหัสต้นทุน |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLTPL — แม่แบบรายการบัญชี
ระเบียน 6 · ความยาวระเบียน 109 byte  
คีย์ (จาก .CDX): `TPLCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `TPLCOD` | C8 | 100 |  | EXPENSE, CASHSALE, CREDIT | gl_template.code |
| `DESCRP` | C50 | 100 | คำอธิบาย |  | gl_template.name |
| `DESCRP2` | C50 | 0 |  |  | gl_template.name |

## GLTPLIT — บรรทัดแม่แบบ
ระเบียน 20 · ความยาวระเบียน 92 byte  
คีย์ (จาก .CDX): `TPLCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `TPLCOD` | C8 | 100 |  | EXPENSE, DEPRE, CASHSALE | gl_template_line.template_id |
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 11-01-01-00, 52-01-00-00, 41-01-00-00 | gl_template_line.account_id |
| `DEPCOD` | C4 | 0 | แผนก |  | gl_template_line.department_id |
| `DESCRP` | C50 | 100 | คำอธิบาย |  | gl_template_line.description |
| `JNLTYP` | C1 | 100 | สมุดรายวัน | 0, 1 | gl_template_line.side |
| `AMOUNT` | N13.2 | 30 | จำนวนเงิน | 10000.0, 2000.0 | gl_template_line.amount |

## GLREP — แบบงบการเงิน
ระเบียน 8 · ความยาวระเบียน 1828 byte  
คีย์ (จาก .CDX): `REPCOD` · `LINCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `REPCOD` | C8 | 100 |  | BALSHT_1, BALSHT_2, BALS_P1 | gl_fs_report.code |
| `REPNAM` | C50 | 100 |  |  | gl_fs_report.name |
| `STATUS` | C1 | 0 | สถานะ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 25 | ผู้แก้ไขล่าสุด | CK | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 25 | วันที่แก้ไขล่าสุด | 20001102 | gl_fs_report.columns |
| `LINCOD` | C8 | 100 |  | BALSHT_1, INCS_1, BALS_P1 | gl_fs_report.line_set_code |
| `HEAD_1` | C60 | 100 |  | \NAME | gl_fs_report.header_lines |
| `HEAD_2` | C60 | 100 |  | งบดุล, งบกำไรขาดทุน, งบต้นทุนขาย | gl_fs_report.header_lines |
| `HEAD_3` | C60 | 100 |  | สิ้นสุด ณ วันที่ \END_PRD, ณ วันที่ \END_PRD | gl_fs_report.header_lines |
| `HEAD_4` | C60 | 0 |  |  | gl_fs_report.header_lines |
| `PICT_1` | C20 | 0 |  |  | gl_fs_report.number_format |
| `PICT_2` | C20 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRNCTRL` | C40 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `C1_HD1` | C15 | 62 |  | ประจำงวด, ปีปัจจุบัน | gl_fs_report.columns |
| `C1_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C2_HD1` | C15 | 50 |  | ปีที่แล้ว, สะสมจากต้นปี | gl_fs_report.columns |
| `C2_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C3_HD1` | C15 | 25 |  | %เปลี่ยนแปลง, .  %เปลี่ยนแปลง | gl_fs_report.columns |
| `C3_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C4_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C4_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C5_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C5_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C6_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C6_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C7_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C7_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C8_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C8_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C9_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C9_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C10_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C10_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C11_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C11_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C12_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C12_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C13_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C13_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C14_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C14_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C15_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C15_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C16_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C16_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C17_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C17_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `C18_HD1` | C15 | 0 |  |  | gl_fs_report.columns |
| `C18_HD2` | C15 | 0 |  |  | gl_fs_report.columns |
| `FLD1` | C25 | 100 |  | BAL, PTD | gl_fs_report.columns |
| `FLD2` | C25 | 50 |  | BAL LY, BAL | gl_fs_report.columns |
| `FLD3` | C25 | 25 |  | (C1-C2)*100/C2 | gl_fs_report.columns |
| `FLD4` | C25 | 0 |  |  | gl_fs_report.columns |
| `FLD5` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD6` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD7` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD8` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD9` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD10` | C35 | 0 |  |  | gl_fs_report.columns |
| `FLD11` | C50 | 0 |  |  | gl_fs_report.columns |
| `FLD12` | C50 | 0 |  |  | gl_fs_report.columns |
| `FLD13` | C50 | 0 |  |  | gl_fs_report.columns |
| `FLD14` | C50 | 0 |  |  | gl_fs_report.columns |
| `FLD15` | C50 | 0 |  |  | gl_fs_report.columns |
| `FLD16` | C60 | 0 |  |  | gl_fs_report.columns |
| `FLD17` | C60 | 0 |  |  | gl_fs_report.columns |
| `FLD18` | C60 | 0 |  |  | gl_fs_report.columns |
| `DEP1` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP2` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP3` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP4` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP5` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP6` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP7` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP8` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP9` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP10` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP11` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP12` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP13` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP14` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP15` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP16` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP17` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEP18` | C6 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT1` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT2` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT3` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT4` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT5` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT6` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT7` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT8` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT9` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT10` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT11` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT12` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT13` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT14` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT15` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT16` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT17` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PCENT18` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT1` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT2` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT3` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT4` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT5` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT6` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT7` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT8` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT9` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT10` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT11` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT12` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT13` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT14` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT15` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT16` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT17` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRINT18` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLREPIT — บรรทัดงบการเงิน
ระเบียน 221 · ความยาวระเบียน 203 byte  
คีย์ (จาก .CDX): `REPCOD+STR(VAL(LINNUM),4,0)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `REPCOD` | C8 | 100 |  | BALS_P1, BALSHT_1, RATIO 1 | gl_fs_line.line_set_code |
| `LINNUM` | C4 | 100 |  |  100,  110,  120 | gl_fs_line.line_no |
| `DATTYP` | C3 | 100 |  | A/C, VAR, --- | gl_fs_line.data_type |
| `SRCDAT` | C31 | 88 |  | ---------------, A | gl_fs_line.source |
| `DEPCOD` | C4 | 0 | แผนก |  | gl_fs_line.department_id |
| `JOBCOD` | C6 | 0 | โครงการ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `FILTER` | C1 | 5 |  | +, - | gl_fs_line.sign_filter |
| `REVERSE` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DESCRP` | C60 | 76 | คำอธิบาย |  | gl_fs_line.description_th |
| `DESCRP2` | C60 | 28 |  |  | gl_fs_line.description_en |
| `PRNCON` | C1 | 49 |  | Z, N | gl_fs_line.print_condition |
| `FONTYP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `VAR_A` | C1 | 34 |  | +, 0 | gl_fs_line.accumulate |
| `VAR_B` | C1 | 11 |  | +, 0 | gl_fs_line.accumulate |
| `VAR_C` | C1 | 18 |  | +, - | gl_fs_line.accumulate |
| `VAR_D` | C1 | 4 |  | +, - | gl_fs_line.accumulate |
| `VAR_E` | C1 | 0 |  |  | gl_fs_line.accumulate |
| `PERCENT` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `EXTFNC` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRNCOL` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## GLREPTMP — ตารางชั่วคราวงบการเงิน
ระเบียน 1 · ความยาวระเบียน 145 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `C1` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C2` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C3` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C4` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C5` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C6` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C7` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C8` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C9` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C10` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C11` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C12` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C13` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C14` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C15` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C16` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C17` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `C18` | B8.2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |

## GLBAL — ยอดสะสมบัญชีรายงวด (ปีก่อน/ปีนี้/ปีหน้า)
ระเบียน 2,325 · ความยาวระเบียน 650 byte  
คีย์ (จาก .CDX): `ACCNUM+DEPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 5200-06, 5320-03, 5200-08 | gl_balance.account_id |
| `DEPCOD` | C4 | 90 | แผนก | EXH, ACC | gl_balance.department_id |
| `JOBCOD` | C6 | 0 | โครงการ |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `CALSTA` | C24 | 100 |  | 11111111111111111111111, 11111111111111111111100, 1111111111 | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BEGLY` | B8.2 | 3 |  | 100000.0, 16728226.82 | gl_balance.opening |
| *(ฟิลด์รายงวด เช่น DEBIT1LY …)* | | | ยอดสะสมแยก 12 งวดปีนี้/ปีหน้า/ปีก่อน | | (คำนวณจากรายการ) |
| `DEBITCLS` | B8.2 | 1 |  | 41475346.74, 932747.27 | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `CREDITCLS` | B8.2 | 4 |  | 2759756.67, 8228646.69 | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |

## GLBUD — งบประมาณ
ระเบียน 0 · ความยาวระเบียน 330 byte  
คีย์ (จาก .CDX): `ACCNUM+DEPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `ACCNUM` | C15 | 0 | เลขที่บัญชี |  | gl_budget.account_id |
| `DEPCOD` | C4 | 0 | แผนก |  | gl_budget.department_id |
| `JOBCOD` | C6 | 0 | โครงการ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `AMT1LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT2LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT3LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT4LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT5LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT6LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT7LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT8LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT9LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT10LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT11LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT12LY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT1` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT2` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT3` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT4` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT5` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT6` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT7` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT8` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT9` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT10` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT11` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT12` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT1NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT2NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT3NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT4NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT5NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT6NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT7NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT8NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT9NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT10NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT11NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `AMT12NY` | B8.2 | 0 |  |  | gl_budget.amount |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## GLINV — ยอดสินค้าคงเหลือรายงวด (Periodic)
ระเบียน 1 · ความยาวระเบียน 332 byte  
คีย์ (จาก .CDX): `ACCNUM+DEPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `ACCNUM` | C15 | 100 | เลขที่บัญชี | 1140-02 | (ยอดสินค้ารายงวดสำหรับ Periodic — คำนวณจาก inv_stock_ledger) |
| `DEPCOD` | C4 | 0 | แผนก |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `BEGLY` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `BAL1LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL2LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL3LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL4LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL5LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL6LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL7LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL8LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL9LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL10LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL11LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL12LY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL1` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL2` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL3` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL4` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL5` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL6` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL7` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL8` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL9` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL10` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL11` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL12` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL1NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL2NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL3NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL4NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL5NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL6NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL7NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL8NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL9NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL10NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL11NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BAL12NY` | B8.2 | 0 |  |  | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## ARBAL — ยอดสะสมลูกหนี้รายงวด (24 งวด × ชนิดเอกสาร)
ระเบียน 129 · ความยาวระเบียน 979 byte  
คีย์ (จาก .CDX): `CUSCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `CUSCOD` | C10 | 100 | รหัสลูกค้า | R-RICE, C-CCD, T-THE | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BEGBAL` | B8.2 | 9 | ยอดยกมา | 5446104.22, 11209967.09 | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| *(ฟิลด์รายงวด เช่น HS1 …)* | | | ยอดสะสมแยก 12 งวดปีนี้/ปีหน้า/ปีก่อน | | (คำนวณจากรายการ) |

## APBAL — ยอดสะสมเจ้าหนี้รายงวด
ระเบียน 1,091 · ความยาวระเบียน 979 byte  
คีย์ (จาก .CDX): `SUPCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SUPCOD` | C10 | 100 | รหัสผู้จำหน่าย | N-NOUL, V-VBUA, M-MED | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| `BEGBAL` | B8.2 | 5 | ยอดยกมา | -98590.4, -614335.62 | (ค่าสะสมรายงวด — คำนวณจากรายการ/ใช้ view) |
| *(ฟิลด์รายงวด เช่น HP1 …)* | | | ยอดสะสมแยก 12 งวดปีนี้/ปีหน้า/ปีก่อน | | (คำนวณจากรายการ) |

## STLOC — ยอดคงเหลือสินค้าแยกคลัง + ยอดเคลื่อนไหวรายงวด
ระเบียน 40,812 · ความยาวระเบียน 555 byte  
คีย์ (จาก .CDX): `STKCOD+LOCCOD` · `LOCCOD+STKCOD` · `STKCOD` · `LOCCOD`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `STKCOD` | C20 | 100 | รหัสสินค้า | 01229, CMCDP-CR, CMCPR-CR | inv_stock_balance.item_id |
| `LOCCOD` | C4 | 100 | รหัสคลัง | HO, SW, GG | inv_stock_balance.warehouse_id |
| `AREA` | C8 | 0 |  |  | inv_stock_balance.shelf |
| `STKCLASS` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `LOCBAL` | B8.4 | 29 |  | 1.0, 2.0 | inv_stock_balance.qty_on_hand |
| `UNITPR` | B8.4 | 30 | ราคาต่อหน่วย | 60.0, 100.0 | inv_stock_balance.avg_cost |
| `LOCVAL` | B8.2 | 24 |  | 300.0, 600.0 | inv_stock_balance.value_on_hand |
| `LOCREO` | B8.4 | 5 |  | 1.0, 10.0 | inv_stock_balance.qty_on_order |
| `LOCRES` | B8.4 | 2 |  | 6.0, 1.0 | inv_stock_balance.qty_reserved |
| `LPURDAT` | D8 | 18 |  | 20101224, 20100810 | inv_stock_balance.last_purchase_date |
| `LSELDAT` | D8 | 16 |  | 20100819, 20100223 | inv_stock_balance.last_sale_date |
| `LMOVDAT` | D8 | 90 |  | 20081231, 20100228 | inv_stock_balance.last_move_date |
| `TAKDAT` | D8 | 49 |  | 20081231, 20081203 | inv_stock_balance.last_count_date |
| `MLOTNUM` | C24 | 88 | ล็อต FIFO (วันที่+เอกสาร+ลำดับที่รับเข้า) | -, 20081231:TK0000035   850 | (inv_cost_layer) |
| `MREMBAL` | B8.4 | 21 | คงเหลือในล็อต | 1.0, 2.0 | (inv_cost_layer) |
| `MREMVAL` | B8.2 | 20 | มูลค่าคงเหลือในล็อต | 300.0, 150.0 | (inv_cost_layer) |
| `BEGBAL` | B8.4 | 7 | ยอดยกมา | 1.0, 2.0 | (ยอดยกมา: doc_header OB) |
| `BEGVAL` | B8.2 | 6 |  | 240.0, 120.0 | (ยอดยกมา: doc_header OB) |
| *(ฟิลด์รายงวด เช่น QTY1 …)* | | | ยอดสะสมแยก 12 งวดปีนี้/ปีหน้า/ปีก่อน | | (คำนวณจากรายการ) |
| `STATUS` | C1 | 100 | สถานะ | A | (สถานะ — ทุกแถว A) |
| `INACTDAT` | D8 | 0 | วันที่เลิกใช้ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## STTAK — ผลการตรวจนับสินค้า
ระเบียน 20,189 · ความยาวระเบียน 131 byte  
คีย์ (จาก .CDX): `LOCCOD+STKCOD` · `LOCCOD+AREA+STKCOD` · `LOCCOD+DTOS(TAKDAT)+STKCOD` · `LOCCOD` · `STKCOD` · `TAKFLG`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `LOCCOD` | C4 | 100 | รหัสคลัง | HO, SW, BX | inv_stock_count.warehouse_id |
| `STKCOD` | C20 | 100 | รหัสสินค้า | 003333192, AC-AC, AC-WRAP-R | inv_stock_count.item_id |
| `AREA` | C8 | 0 |  |  | inv_stock_count.shelf |
| `TAKDAT` | D8 | 100 |  | 20081231, 20081203, 20081213 | inv_stock_count.count_date |
| `CQUQTY` | B8.4 | 100 |  | -1.0 | inv_stock_count.counted_unit_qty |
| `CQUCOD` | C2 | 0 |  | KG | inv_stock_count (หน่วยตรวจนับ) |
| `CFACTOR` | B8.4 | 0 |  | 1.0 | inv_stock_count (ตัวคูณ) |
| `XQUQTY` | B8.4 | 12 |  | 1.0, 2.0 | inv_stock_count.counted_unit_qty |
| `PHYBAL` | B8.4 | 12 | ยอดตรวจนับ | 1.0, 2.0 | inv_stock_count.counted_qty |
| `TRNVAL` | B8.2 | 100 | จำนวนเงิน | -1.0 | (ใช้ภายใน — ค่าคงที่ -1) |
| `TAKFLG` | C1 | 100 |  | 6, 3, 1 | inv_stock_count.flag |
| `DIFQTY` | B8.4 | 22 |  | -1.0, -0.1 | inv_stock_count.diff_qty |
| `DIFVAL` | B8.2 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | TK0000030, TK0000032, TK0000023 | inv_stock_count.adjust_line_id |
| `SEQNUM` | C3 | 100 | ลำดับบรรทัด |   1,   2,   3 | inv_stock_count.adjust_line_id |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | OIL, PLE, YOON | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20090627, 20090622, 20090625 | (คอลัมน์มาตรฐาน updated_by / updated_at) |

## ISVAT — ทะเบียนภาษีซื้อ/ภาษีขาย
ระเบียน 6,890 · ความยาวระเบียน 203 byte  
คีย์ (จาก .CDX): `VATREC+DOCNUM` · `VATREC+DTOS(VATPRD)+DTOS(DOCDAT)+RECTYP+DOCNUM` · `VATREC+RECTYP+DTOS(VATPRD)+DTOS(DOCDAT)+DOCNUM` · `VATREC+DTOS(VATPRD)+DTOS(VATDAT)+RECTYP+DOCNUM` · `VATREC+REFNUM` · `VATREC+DTOS(VATPRD)+DTOS(DOCDAT)+RECTYP+DOCNUM` FOR `.NOT.DELETED() .AND. DOCSTAT='Y'` · `VATREC+DTOS(VATPRD)+DTOS(VATDAT)+RECTYP+DOCNUM` FOR `.NOT.DELETED() .AND. DOCSTAT='Y'`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `VATREC` | C1 | 100 | P=ภาษีซื้อ S=ภาษีขาย | P, S | tax_vat_entry.vat_kind |
| `VATTYP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `RECTYP` | C1 | 99 | ประเภทรายการ (ดูตารางรหัส) | 3, 1, 9 | (ได้จาก doc_header.express_rectype ผ่าน header_id) |
| `VATPRD` | D8 | 100 | งวดภาษีที่ยื่น | 20101101, 20090601, 20100901 | tax_vat_entry.vat_period_id |
| `LATE` | C1 | 0 |  | Y | tax_vat_entry.is_late |
| `VATDAT` | D8 | 100 | วันที่ใบกำกับภาษี | 20090605, 20100630, 20100929 | tax_vat_entry.tax_invoice_date |
| `DOCDAT` | D8 | 100 | วันที่เอกสาร | 20090904, 20101001, 20100702 | tax_vat_entry.doc_date |
| `DOCNUM` | C12 | 100 | เลขที่เอกสาร | PS082/7082, PS085/7208, PS070/6452 | tax_vat_entry.doc_no; tax_vat_entry.header_id |
| `REFNUM` | C15 | 91 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | 074/03671, 061/03001 | tax_vat_entry.tax_invoice_no |
| `NEWNUM` | C10 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DEPCOD` | C4 | 4 | แผนก | PUR, ACC | tax_vat_entry.department_id |
| `DESCRP` | C60 | 100 | คำอธิบาย |  | tax_vat_entry.description |
| `AMT01` | B8.2 | 89 | มูลค่า | 467.29, 934.58 | tax_vat_entry.base_amount |
| `VAT01` | B8.2 | 83 | ภาษี | 32.71, 65.42 | tax_vat_entry.vat_amount |
| `AMT02` | B8.2 | 0 |  |  | tax_vat_entry.nonclaim_base |
| `VAT02` | B8.2 | 0 |  |  | tax_vat_entry.nonclaim_vat |
| `AMTRAT0` | B8.2 | 9 | มูลค่าอัตรา 0% | 100.0, 500.0 | tax_vat_entry.zero_rate_amount |
| `REMARK` | C30 | 9 |  |  | tax_vat_entry.remark |
| `SELF_ADDED` | C1 | 100 | บันทึกเองในระบบภาษี | N, Y | tax_vat_entry.is_manual |
| `HAD_MODIFY` | C1 | 98 | ถูกแก้ในระบบภาษี | N, Y | tax_vat_entry.is_modified |
| `DOCSTAT` | C1 | 98 | สถานะ N=ปกติ M=ครบ/ปิด C=ยกเลิก | N, C | tax_vat_entry.doc_status |

## ISTAX — ทะเบียนภาษีหัก ณ ที่จ่าย
ระเบียน 830 · ความยาวระเบียน 353 byte  
คีย์ (จาก .CDX): `REFNUM` · `TAXTYP+DTOS(TAXPRD)+DTOS(TAXDAT)+TAXNUM` · `TAXTYP+TAXNUM`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `REFNUM` | C12 | 100 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า | PS072/6561, PS074/6666, PS078/6881 | tax_wht_entry.header_id |
| `TAXNUM` | C12 | 100 | เลขที่หนังสือรับรอง | PS078/6881, PS081/7017, PS083/7116 | tax_wht_entry.certificate_no |
| `TAXDAT` | D8 | 100 | วันที่หัก | 20100702, 20101015, 20100430 | tax_wht_entry.certificate_date |
| `DEPCOD` | C4 | 0 | แผนก |  | tax_wht_entry.department_id |
| `TAXPRD` | D8 | 100 | เดือนภาษี | 20101001, 20100701, 20101201 | tax_wht_entry.tax_period_id |
| `LATE` | C1 | 0 |  |  | tax_wht_entry.is_late |
| `PEOPLE` | C10 | 100 | คู่ค้า/คลังปลายทาง | N-NORTHERN, T-TOY_CR, A-AAL | tax_wht_entry.customer_id; tax_wht_entry.supplier_id |
| `NAME` | C60 | 100 |  |  | tax_wht_entry.payee_name |
| `ADDR` | C100 | 100 |  |  | tax_wht_entry.payee_address |
| `TAXID` | C15 | 100 | เลขผู้เสียภาษี |  | tax_wht_entry.payee_tax_id |
| `TAXDES` | C25 | 100 |  |  | tax_wht_entry.income_type |
| `AMOUNT` | B8.2 | 100 | จำนวนเงิน | 22896.0, 1000.0, 550.0 | tax_wht_entry.paid_amount |
| `TAXRAT` | N5.2 | 100 | อัตราภาษีหัก ณ ที่จ่าย | 3.0, 1.0, 5.0 | tax_wht_entry.rate |
| `TAXAMT` | B8.2 | 100 | ภาษีที่หัก | 686.88, 16.5, 30.0 | tax_wht_entry.tax_amount |
| `TAXTYP` | C4 | 100 | แบบ ภ.ง.ด. | S03, S53 | tax_wht_entry.form_type |
| `TAXCOND` | C1 | 100 | เงื่อนไขการหัก | 1, 2 | tax_wht_entry.condition |
| `SOCIALAMT` | B8.2 | 0 |  |  | tax_wht_entry.social_security_amount |
| `POVDNT` | B8.2 | 0 |  |  | tax_wht_entry.provident_fund_amount |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 3 | ผู้พิมพ์ | PLEACC, TS | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 3 | วันที่พิมพ์ | 20101129, 20101202 | last_printed_at |
| `PRNCNT` | N2 | 3 | จำนวนครั้งที่พิมพ์ | 1.0, 3.0 | tax_wht_entry.print_count |
| `PRNTIM` | C5 | 3 | เวลาพิมพ์ | 15:23, 13:53 | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## ISSN — ทะเบียน Serial
ระเบียน 0 · ความยาวระเบียน 306 byte  
คีย์ (จาก .CDX): `SERIAL`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SERIAL` | C15 | 0 |  |  | md_serial.serial_no |
| `M_NO` | C15 | 0 |  |  | md_serial.machine_no |
| `M_INFO` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `STKGRP` | C4 | 0 |  |  | md_serial.category_code |
| `IVCNUM` | C12 | 0 |  |  | md_serial.sale_line_id |
| `SAL_DATE` | D8 | 0 |  |  | md_serial.sale_date |
| `EXP_DATE` | D8 | 0 |  |  | md_serial.warranty_end |
| `REFNUM` | C15 | 0 | เลขที่อ้างอิง/ใบกำกับของคู่ค้า |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `REFDAT` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DESCRIP` | C50 | 0 |  |  | md_serial.description |
| `CUSNAM` | C45 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `CUSCOD` | C10 | 0 | รหัสลูกค้า |  | md_serial.customer_id |
| `SLMNAM` | C45 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPRN` | C8 | 0 | ผู้พิมพ์ |  | doc_header.last_printed_by / print_count |
| `PRNDAT` | D8 | 0 | วันที่พิมพ์ |  | last_printed_at |
| `PRNCNT` | N2 | 0 | จำนวนครั้งที่พิมพ์ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `PRNTIM` | C5 | 0 | เวลาพิมพ์ |  | last_printed_at |
| `AUTHID` | C8 | 0 | ผู้อนุมัติแทน |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `APPROVE` | D8 | 0 | วันที่อนุมัติ |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## ISSNIT — ประวัติบริการ Serial
ระเบียน 0 · ความยาวระเบียน 114 byte  
คีย์ (จาก .CDX): `SERIAL+DTOS(DATE)`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `SERIAL` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `DATE` | D8 | 0 |  |  | md_serial_service.service_date |
| `SERVANT` | C10 | 0 |  |  | md_serial_service.service_by |
| `SERVDESC` | C80 | 0 |  |  | md_serial_service.detail |

## ISREP — รายงานที่ผู้ใช้แก้ไข
ระเบียน 24 · ความยาวระเบียน 102 byte  
คีย์ (จาก .CDX): `FNAME` · `FNAME` FOR `.NOT.DELETED().AND.ISMODIFY=.T.` · `DESC` · `DESC` FOR `.NOT.DELETED().AND.ISMODIFY=.T.`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `FNAME` | C8 | 100 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `DESC` | C50 | 100 |  | 523  สมุดรายวัน เรียงตามเลขที่บัญชี, 853  สรุปยอดซื้อ แยกตาม | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `REPID` | C15 | 100 |  | st_sal, st_masdet, gl_jnl3x | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `PARAM` | C10 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `ISMODIFY` | L1 | 100 |  | Y | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `USERID` | C8 | 100 | ผู้แก้ไขล่าสุด | TS, MOOK | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 100 | วันที่แก้ไขล่าสุด | 20080213, 20081106, 20090815 | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `STDSCP` | L1 | 100 |  | Y | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |

## ISFIXCOD — ประวัติการเปลี่ยนรหัส
ระเบียน 0 · ความยาวระเบียน 73 byte  
คีย์ (จาก .CDX): `CODTYP+OLDCOD+OLDDEP` · `OLDCOD+OLDDEP` · `NEWCOD+NEWDEP`

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `CODTYP` | C1 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `OLDCOD` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `OLDDEP` | C4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `NEWCOD` | C15 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `NEWDEP` | C4 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `FLAG` | C1 | 0 | สถานะบรรทัด |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `USERID` | C8 | 0 | ผู้แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `CHGDAT` | D8 | 0 | วันที่แก้ไขล่าสุด |  | (คอลัมน์มาตรฐาน updated_by / updated_at) |
| `USERPOS` | C8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |
| `POSDAT` | D8 | 0 |  |  | (ไม่มีข้อมูลในชุดตัวอย่าง) |

## STSTA — ตารางชั่วคราวรายงานสรุปขาย
ระเบียน 3 · ความยาวระเบียน 119 byte

| ฟิลด์ | ชนิด | กรอก % | ความหมาย | ค่าที่พบบ่อย | ระบบใหม่ |
|---|---|---|---|---|---|
| `PEOPLE` | C10 | 100 | คู่ค้า/คลังปลายทาง | สบายใจ, ไซเบอร์, ไทยซัพพลาย | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `STKCOD` | C15 | 0 | รหัสสินค้า |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `SLMCOD` | C10 | 0 | พนักงานขาย |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `STKDES` | C45 | 100 | ชื่อสินค้า |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `QUCOD` | C2 | 0 |  |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `TRNQTY` | N12.3 | 0 | จำนวน |  | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `SALVAL` | N12.2 | 100 |  | 51908.38, 43442.0, 91164.0 | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |
| `TRNVAL` | N12.2 | 100 | จำนวนเงิน | 51908.38, 43442.0, 91164.0 | (ตารางชั่วคราว/รายงาน — ไม่ย้าย) |

