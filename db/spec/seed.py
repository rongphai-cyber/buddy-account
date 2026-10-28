# -*- coding: utf-8 -*-
"""สร้าง seed SQL: ข้อมูลอ้างอิงกลาง + แม่แบบกฎการลงบัญชีต่อบริษัท"""
import sys, os, json
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'generated'))
def q(s): return 'NULL' if s is None else "'" + str(s).replace("'", "''") + "'"

LOOKUP_TYPES = [('01','ธนาคาร',0),('02','สถานะเช็ค',0),('10','สมุดรายวัน',0),('20','หน่วยนับ',1),('21','คลังสินค้า',0),('22','หมวดสินค้า',0),('23','ระดับสินค้า',0),
 ('40','เขตการขาย',0),('41','ขนส่งโดย',0),('42','เหตุผลยกเลิก (ขาย)',0),('43','เหตุผลยกเลิก (ซื้อ)',0),('44','สถานะใบเสนอราคา',0),('45','ประเภทลูกค้า',0),('46','ประเภทผู้จำหน่าย',0),
 ('47','ประเภทพนักงานขาย',0),('50','แผนก',0),('51','คำนำหน้าชื่อ',0),('52','หมวดทรัพย์สิน',0),('53','สถานะเงินสดย่อย',0),('55','แบบภาษีหัก ณ ที่จ่าย',0),('60','Collection/ฤดูกาล',0)]

# บทบาทบัญชีมาตรฐาน 34 ตัว (ลำดับตรงกับ ISINFO.ACCNUM00–34) — ยืนยันจากชื่อบัญชีในผังบัญชีจริง
ROLES = [('CASH','เงินสด',0),('AR','ลูกหนี้การค้า',2),('CHEQUE_RECEIVED','เช็ครับลงวันที่ล่วงหน้า',3),('INVENTORY','สินค้าคงเหลือ',4),('PREPAID_TAX','ภาษีเงินได้ถูกหัก/จ่ายล่วงหน้า',5),
 ('INPUT_VAT','ภาษีซื้อ',6),('AP','เจ้าหนี้การค้า',7),('CHEQUE_PAID','เช็คจ่ายลงวันที่ล่วงหน้า',8),('WHT_PAYABLE','ภาษีหัก ณ ที่จ่ายค้างจ่าย',9),('OUTPUT_VAT','ภาษีขาย',10),
 ('CASH_SALES','ขายเงินสด',11),('CREDIT_SALES','ขายเงินเชื่อ',12),('SALES_RETURN','รับคืน/ลดหนี้',13),('SALES_DISCOUNT','ส่วนลดจ่าย',14),('INTEREST_INCOME','ดอกเบี้ยรับ',15),
 ('BANK_INCOME','รายได้จากธนาคาร',16),('COGS','ต้นทุนขาย',17),('PURCHASES','ซื้อ (Periodic)',18),('PURCHASE_RETURN','ส่งคืน (Periodic)',19),('PURCHASE_DISCOUNT','ส่วนลดรับ',20),
 ('INTEREST_EXPENSE','ดอกเบี้ยจ่าย',21),('BANK_CHARGE','ค่าธรรมเนียมธนาคาร',22),('RETAINED_EARNINGS','กำไร(ขาดทุน)สะสม',23),('SUSPENSE','บัญชีพัก',24),('BAD_DEBT','หนี้สูญ',25),
 ('OTHER_INCOME','รายได้อื่น',26),('OUTPUT_VAT_PENDING','ภาษีขาย-รอเรียกเก็บ',27),('INPUT_VAT_PENDING','ภาษีซื้อ-ยังไม่ถึงกำหนด',28),('OTHER_EXPENSE','ค่าใช้จ่ายอื่น',29),
 ('DEPOSIT_PAID','เงินมัดจำจ่าย',30),('DEPOSIT_RECEIVED','เงินมัดจำรับ',31),('PETTY_CASH','เงินสดย่อย',32),('INPUT_VAT_NONCLAIM','ภาษีซื้อไม่ขอคืน',33),('INPUT_VAT_UNCLAIMABLE','ภาษีซื้อขอคืนไม่ได้',34)]

# กฎการลงบัญชี — ตรงกับ posting_engine.py และยืนยันกับใบสำคัญ 15,382 ใบของข้อมูลจริง (ตรงทุกบัญชี 97.0%)
# (doc_class, seq, condition, side, role, amount_source, per, description, evidence%)
R = [
 ('IV',1,None,'D','AR','H.net_amount','H','ลูกหนี้ (บัญชีของลูกค้า → บัญชีมาตรฐาน)',98.1),
 ('IV',2,None,'C','SALES','L.net_amount','L','ขาย (ประเภทเอกสาร ช่อง 5 → กลุ่มบัญชีสินค้า ช่อง 3 → ขายเชื่อ)',98.1),
 ('IV',3,'VAT_ACCRUAL','C','OUTPUT_VAT','H.vat_amount','H','ภาษีขาย',98.1),
 ('IV',4,'VAT_CASH','C','OUTPUT_VAT_PENDING','H.vat_amount','H','ภาษีขายรอเรียกเก็บ (บริการ เกณฑ์เงินสด)',98.1),
 ('IV',5,'HAS_DEPOSIT','D','DEPOSIT_RECEIVED','H.deposit_used','H','หักเงินมัดจำรับ = (รายการ+VAT) − ยอดสุทธิ',98.1),
 ('IV',6,'PERPETUAL_ONLY','D','COGS','L.cost_amount','L','ต้นทุนขาย (เฉพาะ Perpetual)',None),
 ('IV',7,'PERPETUAL_ONLY','C','INVENTORY','L.cost_amount','L','สินค้าคงเหลือ (เฉพาะ Perpetual)',None),
 ('HS',1,None,'D','CASH','H.net_amount','H','เงินสด/วิธีรับเงิน',None),
 ('HS',2,None,'C','SALES','L.net_amount','L','ขายสด',None),
 ('HS',3,None,'C','OUTPUT_VAT','H.vat_amount','H','ภาษีขาย',None),
 ('DR',1,None,'D','AR','H.net_amount','H','ลูกหนี้',100.0),('DR',2,None,'C','SALES','L.net_amount','L','ขาย',100.0),('DR',3,None,'C','OUTPUT_VAT','H.vat_amount','H','ภาษีขาย',100.0),
 ('CN',1,None,'C','AR','H.net_amount','H','ลูกหนี้',97.7),('CN',2,None,'D','SALES_RETURN','L.net_amount','L','รับคืน (กลุ่มบัญชีสินค้า ช่อง 4 → รับคืน)',97.7),
 ('CN',3,None,'D','OUTPUT_VAT','H.vat_amount','H','ภาษีขาย',97.7),
 ('CN',4,'PERPETUAL_ONLY','D','INVENTORY','L.cost_amount','L','รับสินค้าคืนเข้าสต๊อก (Perpetual, return_to_stock)',None),
 ('CN',5,'PERPETUAL_ONLY','C','COGS','L.cost_amount','L','กลับต้นทุนขาย',None),
 ('AI',1,None,'D','PAYMENT','P.amount','P','วิธีรับเงิน (บัญชีของวิธีชำระ → บัญชีเงินฝากของรายการโอน)',100.0),
 ('AI',2,None,'D','CASH','H.cash_rest','H','ส่วนที่รับเป็นเงินสด',100.0),
 ('AI',3,None,'C','DEPOSIT_RECEIVED','H.net_minus_vat','H','เงินมัดจำรับ (ประเภทเอกสาร ช่อง 3 → มาตรฐาน)',100.0),
 ('AI',4,None,'C','OUTPUT_VAT','H.vat_amount','H','ภาษีขายของเงินมัดจำ',100.0),
 ('RE',1,None,'C','AR','S.signed_amount','S','ตัดลูกหนี้รายใบ (ใบลดหนี้ = ลบ, มัดจำไม่กระทบ)',98.6),
 ('RE',2,'VAT_CASH','D','OUTPUT_VAT_PENDING','S.vat_amount','S','โอนภาษีขายรอเรียกเก็บ',98.6),
 ('RE',3,'VAT_CASH','C','OUTPUT_VAT','S.vat_amount','S','เป็นภาษีขาย',98.6),
 ('RE',4,None,'D','PAYMENT','P.amount','P','วิธีรับเงิน (โอน เช็ค ค่าธรรมเนียม ภาษีถูกหัก อัตราแลกเปลี่ยน ส่วนขาดเกิน)',98.6),
 ('RE',5,None,'D','CASH','H.cash_rest','H','ส่วนที่รับเป็นเงินสด',98.6),
 ('OI',1,None,'D','PAYMENT','P.amount','P','วิธีรับเงิน',None),('OI',2,None,'C','OTHER_INCOME','L.net_amount','L','รายได้อื่น (กลุ่มบัญชีของรหัสรายได้)',None),('OI',3,None,'C','OUTPUT_VAT','H.vat_amount','H','ภาษีขาย',None),
 ('RR',1,None,'D','PURCHASE','L.net_amount','L','ซื้อ (Periodic: กลุ่มบัญชีสินค้า ช่อง 5 / Perpetual: ช่อง 1 / รหัสค่าใช้จ่าย: ช่อง 1)',95.8),
 ('RR',2,'VAT_ACCRUAL','D','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',95.8),('RR',3,'VAT_CASH','D','INPUT_VAT_PENDING','H.vat_amount','H','ภาษีซื้อยังไม่ถึงกำหนด',95.8),
 ('RR',4,None,'C','AP','H.net_amount','H','เจ้าหนี้ (ประเภทเอกสาร ช่อง 3 → บัญชีของผู้จำหน่าย → มาตรฐาน)',95.8),
 ('RR',5,'HAS_DEPOSIT','C','DEPOSIT_PAID','H.deposit_used','H','หักเงินมัดจำจ่าย',95.8),
 ('HP',1,None,'D','PURCHASE','L.net_amount','L','ซื้อ/ค่าใช้จ่าย',96.5),('HP',2,None,'D','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',96.5),
 ('HP',3,None,'C','PAYMENT','P.amount','P','วิธีจ่ายเงิน',96.5),('HP',4,None,'C','CASH','H.cash_rest','H','ส่วนที่เหลือ: ประเภทเอกสาร ช่อง 4 (PP = เจ้าหนี้เงินสดย่อย) → เงินสด',96.5),
 ('CP',1,None,'D','PURCHASE','L.net_amount','L','ซื้อ',66.7),('CP',2,None,'D','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',66.7),('CP',3,None,'C','AP','H.net_amount','H','เจ้าหนี้',66.7),
 ('DN',1,None,'D','AP','H.net_amount','H','เจ้าหนี้',87.0),('DN',2,None,'C','PURCHASE_RETURN','L.net_amount','L','ส่งคืน (กลุ่มบัญชีสินค้า ช่อง 6)',87.0),('DN',3,None,'C','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',87.0),
 ('PS',1,None,'D','AP','S.signed_amount','S','ตัดเจ้าหนี้รายใบ (ใบลดหนี้ = ลบ, มัดจำไม่กระทบ)',98.6),
 ('PS',2,'VAT_CASH','D','INPUT_VAT','S.vat_amount','S','ภาษีซื้อถึงกำหนด',98.6),('PS',3,'VAT_CASH','C','INPUT_VAT_PENDING','S.vat_amount','S','โอนจากภาษีซื้อยังไม่ถึงกำหนด',98.6),
 ('PS',4,None,'C','PAYMENT','P.amount','P','วิธีจ่ายเงิน (โอน เช็คจ่าย ภาษีหัก ณ ที่จ่าย ค่าธรรมเนียม หักมัดจำ ส่วนขาดเกิน)',98.6),
 ('PS',5,None,'C','CASH','H.cash_rest','H','ส่วนที่จ่ายเป็นเงินสด',98.6),
 ('AE',1,None,'D','DEPOSIT_PAID','H.net_minus_vat','H','มัดจำ/เงินทดรองจ่าย (ประเภทเอกสาร ช่อง 1)',99.6),('AE',2,None,'D','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',99.6),
 ('AE',3,None,'C','PAYMENT','P.amount','P','วิธีจ่ายเงิน',99.6),('AE',4,None,'C','CASH','H.cash_rest','H','ส่วนที่เหลือ (ประเภทเอกสาร ช่อง 3 → เงินสด)',99.6),
 ('OE',1,None,'D','EXPENSE','L.net_amount','L','ค่าใช้จ่าย (กลุ่มบัญชีของรหัสค่าใช้จ่าย ช่อง 1)',98.9),('OE',2,None,'D','INPUT_VAT','H.vat_amount','H','ภาษีซื้อ',98.9),
 ('OE',3,None,'C','PAYMENT','P.amount','P','วิธีจ่ายเงิน (รวมภาษีหัก ณ ที่จ่าย ประกันสังคม)',98.9),('OE',4,None,'C','CASH','H.cash_rest','H','ส่วนที่จ่ายเป็นเงินสด',98.9),
 ('OU',1,None,'D','ISSUE_DEBIT','L.cost_amount','L','ประเภทเอกสาร ช่อง 1 (เช่น ค่าสินค้าตัวอย่าง/งานระหว่างทำ)',100.0),
 ('OU',2,None,'C','ISSUE_CREDIT','L.cost_amount','L','ประเภทเอกสาร ช่อง 2 (Periodic = ต้นทุนขาย, Perpetual = สินค้า)',100.0),
 ('JU',1,None,'D','ADJ_DEBIT','L.cost_amount','L','ปรับปรุงเพิ่ม: สินค้า / ประเภทเอกสาร ช่อง 1',None),('JU',2,None,'C','ADJ_CREDIT','L.cost_amount','L','ปรับปรุงเพิ่ม: ประเภทเอกสาร ช่อง 2',None),
 ('VR',1,None,'D','PETTY_CASH_PAYABLE','H.net_amount','H','เจ้าหนี้เงินสดย่อย',100.0),('VR',2,None,'C','PETTY_CASH','H.net_amount','H','เงินสดย่อย/วิธีจ่าย',100.0),
 ('BD',1,None,'D','BANK','H.net_amount','H','บัญชีเงินฝาก (md_bank_account.gl_account)',None),('BD',2,None,'C','CASH','H.net_amount','H','เงินสด (ประเภทเอกสาร ช่อง 2)',None),
 ('BW',1,None,'D','CASH','H.net_amount','H','เงินสด (ช่อง 1)',None),('BW',2,None,'C','BANK','H.net_amount','H','บัญชีเงินฝาก',None),
 ('BT',1,None,'D','BANK_TO','H.net_amount','H','บัญชีปลายทาง',None),('BT',2,None,'D','BANK_CHARGE','H.charge','H','ค่าธรรมเนียม',None),('BT',3,None,'C','BANK','H.amount','H','บัญชีต้นทาง',None),
 ('BU',1,None,'D','BANK','H.net_amount','H','บัญชีเงินฝาก',None),('BU',2,None,'D','PREPAID_TAX','H.wht_amount','H','ภาษีถูกหัก',None),('BU',3,None,'C','BANK_INCOME','H.amount','H','ดอกเบี้ยรับ (ช่อง 2)',None),
 ('BV',1,None,'D','BANK_EXPENSE','H.amount','H','ดอกเบี้ยจ่าย/ค่าธรรมเนียม (ช่อง 1)',None),('BV',2,None,'C','BANK','H.amount','H','บัญชีเงินฝาก',None),
 ('BQ',1,'ON_PASS','D','BANK','H.net_amount','H','เงินฝาก (เมื่อเช็คผ่าน)',None),('BQ',2,'ON_PASS','D','BANK_CHARGE','H.charge','H','ค่าธรรมเนียม (ช่อง 2)',None),
 ('BQ',3,'ON_PASS','C','CHEQUE_RECEIVED','H.amount','H','เช็ครับล่วงหน้า',None),
]
SLOT = {'RR': {3: 'AP'}, 'CP': {3: 'AP'}, 'DN': {3: 'AP'}, 'HP': {3: 'ROUNDING', 4: 'CASH'}, 'RE': {3: 'ROUNDING', 6: 'ROUNDING'}, 'PS': {2: 'ROUNDING', 5: 'ROUNDING'},
        'AE': {1: 'DEPOSIT_PAID', 3: 'CASH'}, 'AI': {3: 'DEPOSIT_RECEIVED'}, 'HS': {5: 'SALES'}, 'OU': {1: 'ISSUE_DEBIT', 2: 'ISSUE_CREDIT'}, 'JU': {1: 'ADJ_DEBIT', 2: 'ADJ_CREDIT'},
        'CA': {2: 'COST_ADJ'}, 'BD': {2: 'CASH'}, 'BW': {1: 'CASH'}, 'QP': {1: 'CASH'}, 'BU': {2: 'BANK_INCOME'}, 'BV': {1: 'BANK_EXPENSE'}, 'BQ': {2: 'BANK_CHARGE'}}
JR = [('CASH_PURCHASE','04'),('CREDIT_PURCHASE','04'),('PURCHASE_RETURN','04'),('OTHER_EXPENSE','01'),('AP_PAYMENT','01'),('PASS_CHEQUE_PAID','01'),('CASH_SALE','03'),('CREDIT_SALE','03'),
      ('SALES_RETURN','03'),('OTHER_INCOME','02'),('AR_RECEIPT','02'),('PASS_CHEQUE_RCV','02'),('INTERNAL_ISSUE','00'),('STOCK_COUNT_ADJ','00'),('COST_ADJ','00'),('BAD_DEBT','01'),
      ('BANK_MOVEMENT','00'),('CHEQUE_EXCESS_INCOME','02'),('CHEQUE_EXCESS_EXPENSE','01'),('AR_DEPOSIT','02'),('AP_DEPOSIT','01'),('DEPRECIATION','00'),('AR_DEBIT_NOTE','03'),('AP_CREDIT_NOTE','04')]
SETTINGS = [
 ('gen.link_gl','GEN','bool','true','เชื่อมต่อระบบบัญชี (ส่งรายการไป GL อัตโนมัติ)','LINKGL'),
 ('gen.vat_rate','GEN','decimal','7','อัตราภาษีมูลค่าเพิ่ม','VATRAT'),
 ('gen.price_type','GEN','code','"2"','ประเภทราคา default 0=ไม่มี VAT 1=รวม 2=แยก','FLGVAT'),
 ('gen.year_system','GEN','code','"B"','ระบบปี B=พ.ศ. C=ค.ศ.','YEARTHAI'),
 ('gen.use_department','GEN','bool','true','ใช้แผนก','USEDEP'),
 ('gen.use_project','GEN','bool','false','ใช้โครงการ/Job','USEJOB'),
 ('gen.business_type','GEN','code','"J"','ประเภทกิจการ J=นิติบุคคล P=บุคคลธรรมดา','ISINFO.BUSTYP'),
 ('gen.branch_short_name','GEN','text','""','ชื่อย่อสาขา (เริ่มระบบ 1.1 ข้อ 5.2)','ISINFO.BRNSHORT'),
 ('gen.allow_blank_party_tax_id','GEN','bool','true','ยอมให้เลขผู้เสียภาษีของลูกค้า/ผู้จำหน่ายว่างได้ (ข้อ 5.3)','ISINFO.TAXIDBLANK'),
 ('ic.posting_method','IC','code','"PERIODIC"','วิธีบันทึกบัญชีสินค้า PERPETUAL / PERIODIC','ISPERPETUA'),
 ('ic.cost_method','IC','code','"FIFO"','วิธีคิดต้นทุน FIFO / AVERAGE','COSMTD'),
 ('ic.cost_by_warehouse','IC','bool','true','คิดต้นทุนแยกคลัง','LOC_COST'),
 ('ic.allow_negative','IC','bool','true','ยอมให้สต๊อกติดลบ','NEGALLOW'),
 ('ic.negative_check_level','IC','int','0','ระดับอนุมัติเมื่อสต๊อกติดลบ','CHKNEGLEV'),
 ('ic.any_warehouse','IC','bool','true','ใช้คลังใดก็ได้ในเอกสาร','ANYLOC'),
 ('ic.main_warehouse','IC','code','"HO"','คลังหลัก','MAINLOC'),
 ('ic.item_code_mask','IC','text','"!!!!!!!!!!!!!!!!!!!!"','รูปแบบรหัสสินค้า','STPICT'),
 ('ic.use_barcode','IC','bool','true','ใช้บาร์โค้ด','USEBARCOD'),
 ('ic.use_count_unit','IC','bool','true','ใช้หน่วยตรวจนับ','USE_CQU'),
 ('ic.edit_unit_sales','IC','bool','true','แก้หน่วยในเอกสารขาย','SEDITQU'),('ic.edit_factor_sales','IC','bool','true','แก้ตัวคูณในเอกสารขาย','SEDITFAC'),
 ('ic.edit_unit_purchase','IC','bool','true','แก้หน่วยในเอกสารซื้อ','PEDITQU'),('ic.edit_factor_purchase','IC','bool','true','แก้ตัวคูณในเอกสารซื้อ','PEDITFAC'),
 ('ic.aging_days','IC','json','[30,60,90]','ช่วงวิเคราะห์อายุสินค้า','STAGE1-3'),
 ('ic.decimals','IC','json','{"price":2,"qty":2,"factor":2}','จำนวนทศนิยม ราคา/จำนวน/ตัวคูณ','DSIMLPRI/QTY/FAC'),
 ('ic.udf_labels','IC','json','{"str1":"Product","str2":"Collection","str3":"รหัสสินค้าผู้ขาย","str4":"Type Of Product","date1":"วันหมดอายุ"}','ชื่อช่องกำหนดเองของสินค้า','ST_STR1-4, ST_DAT1'),
 ('ar.aging_due','AR','json','[30,60]','ช่วงวิเคราะห์อายุลูกหนี้ (ยังไม่ครบกำหนด)','ARDUE1-2'),
 ('ar.aging_overdue','AR','json','[15,30,60]','ช่วงวิเคราะห์อายุลูกหนี้ (เกินกำหนด)','AROVR1-3'),
 ('ar.allow_over_credit','AR','bool','true','ยอมขายเกินวงเงิน','OVRCRALLOW'),
 ('ar.credit_tiers','AR','json','[]','ระดับวงเงินและระดับอนุมัติ 5 ขั้น','CRLINE_A–E, CRLINE_A_L–E_L'),
 ('ar.so_credit_lock','AR','bool','false','ล็อกใบสั่งขายเมื่อเกินวงเงิน','SO_CR_LOCK'),
 ('ar.change_sales_price','AR','bool','true','แก้ราคาขายได้','CHGSALPR'),('ar.warn_below_cost','AR','bool','true','เตือนขายต่ำกว่าทุน','LOSESAL'),
 ('ar.credit_note_deduct','AR','code','"2"','วิธีหักใบลดหนี้','CNDEDUCT'),('ar.service_vat_basis','AR','code','"3"','เกณฑ์ภาษีบริการ default','SRV_VATTYP'),
 ('ap.aging_due','AP','json','[30,60]','ช่วงวิเคราะห์อายุเจ้าหนี้ (ยังไม่ครบกำหนด)','APDUE1-2'),('ap.aging_overdue','AP','json','[15,30,60]','ช่วงวิเคราะห์อายุเจ้าหนี้ (เกินกำหนด)','APOVR1-3'),
 ('ap.debit_note_deduct','AP','code','"2"','วิธีหักใบลดหนี้ (ซื้อ)','DNDEDUCT'),
 ('fn.default_deposit_bank','FN','code','"C2"','บัญชีเงินฝาก default สำหรับนำฝาก','BNKDEP'),('fn.default_paid_bank','FN','code','"C1"','บัญชีเงินฝาก default สำหรับสั่งจ่าย','BNKPAID'),
 ('fn.auto_pass_cheque_paid','FN','bool','false','ผ่านเช็คจ่ายอัตโนมัติ','PASPCQAUTO'),
 ('fn.wht_min_amount','FN','decimal','1000','ยอดขั้นต่ำที่ต้องหักภาษี ณ ที่จ่าย','MINTAXAMT'),('fn.wht_default_rate','FN','decimal','3','อัตราหัก ณ ที่จ่าย default','MINTAXRAT'),
 ('gl.account_mask','GL','text','"9999-99"','รูปแบบเลขที่บัญชี','GLPICT'),('gl.voucher_numbering','GL','code','"4"','รูปแบบออกเลขใบสำคัญ','GLRUNNING'),
 ('gl.petty_cash_columns','GL','json','[{"label":"ซื้อสินค้า","account":"5130-01"},{"label":"วัสดุสิ้นเปลือง","account":"5150-03"},{"label":"ค่าน้ำมันรถ","account":"5200-09"},{"label":"ภาษีซื้อ","account":"1154-01"}]','คอลัมน์บัญชีในหน้าจอเงินสดย่อย','PT_STR1–5, PETTY1–5'),
 ('fa.asset_code_mask','FA','text','"!-!!-!!!!"','รูปแบบรหัสทรัพย์สิน','FAPICT'),('fa.depreciate_on_entry','FA','bool','true','คิดค่าเสื่อมอัตโนมัติ','FADPRAUTO'),
 ('fa.depreciate_monthly','FA','bool','true','คิดค่าเสื่อมรายเดือน','FADPRMONLY'),('fa.depreciation_method','FA','code','"1"','วิธีคิดค่าเสื่อม default','DPRMETHOD'),
 ('tax.input_vat_prorate','TAX','bool','false','เฉลี่ยภาษีซื้อ (กิจการมีรายได้ยกเว้น VAT)','PVATPRORAT'),
 ('sync.offline_days_allowed','SYNC','int','7','ทำงานออฟไลน์ได้สูงสุดกี่วันก่อนต้องซิงก์ (ใหม่)',None),
 ('sync.block_size','SYNC','int','200','จำนวนเลขที่เอกสารที่จองให้เครื่องต่อครั้ง (ใหม่)',None),
 ('sync.offline_allowed_doc_classes','SYNC','json','["HS","IV","RE","SO","QT","OU","RL","JU","DP"]','ชนิดเอกสารที่อนุญาตให้ออกตอนออฟไลน์ (ใหม่)',None),
]

L = ['-- ข้อมูลอ้างอิงกลาง (ไม่ขึ้นกับบริษัท) — รันครั้งเดียวหลัง schema_postgres.sql', 'BEGIN;']
for c, n, r in LOOKUP_TYPES:
    L.append(f"INSERT INTO md_lookup_type(id, code, name_th, has_rate) VALUES (gen_random_uuid(), {q(c)}, {q(n)}, {'true' if r else 'false'}) ON CONFLICT DO NOTHING;")
for k, m, t, d, lbl, ex in SETTINGS:
    L.append(f"INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), {q(k)}, {q(m)}, {q(t)}, {q(d)}::jsonb, {q(lbl)}, {q(ex)}) ON CONFLICT DO NOTHING;")
L.append('COMMIT;')
open(os.path.join(OUT, 'seed_reference.sql'), 'w').write('\n'.join(L) + '\n')

L = ['-- แม่แบบสำหรับบริษัทใหม่: กฎการลงบัญชี + เส้นทางสมุดรายวัน', '-- ใช้:  psql -v company_id=<uuid ของบริษัท> -f seed_company_template.sql',
     '-- บทบาทบัญชีมาตรฐาน (gl_default_account) ต้องผูกเลขที่บัญชีของบริษัทเองหลังสร้างผังบัญชี — ดูรายการบทบาทในตาราง _role_catalog ด้านล่าง', 'BEGIN;',
     'CREATE TEMP TABLE _role_catalog(role text, label_th text, express_slot int) ON COMMIT DROP;']
for r, n, i in ROLES: L.append(f"INSERT INTO _role_catalog VALUES ({q(r)}, {q(n)}, {i});")
for (cls, seq, cond, side, role, src, per, desc, ev) in R:
    assumed = 'true' if ev is None else 'false'
    d = desc + (f' [ยืนยันกับใบสำคัญจริง {ev:.1f}%]' if ev is not None else ' [ยังไม่มีข้อมูลยืนยัน — ตามคู่มือบทที่ 10]')
    L.append(f"INSERT INTO gl_posting_rule(company_id, doc_class, seq, condition, side, account_role, amount_source, per, description, is_assumed) VALUES (:'company_id', {q(cls)}, {seq}, {q(cond)}, {q(side)}, {q(role)}, {q(src)}, {q(per)}, {q(d)}, {assumed}) ON CONFLICT DO NOTHING;")
L.append('-- ความหมายของช่องบัญชีที่ประเภทเอกสาร (md_doc_type_account.role) — ใช้ตอนผูกบัญชีให้ประเภทเอกสาร')
L.append('CREATE TEMP TABLE _doc_type_slot_role(doc_class text, slot int, role text) ON COMMIT DROP;')
for cls, d in SLOT.items():
    for s, r in d.items(): L.append(f"INSERT INTO _doc_type_slot_role VALUES ({q(cls)}, {s}, {q(r)});")
L.append("UPDATE md_doc_type_account a SET role = s.role FROM md_doc_type t, _doc_type_slot_role s WHERE t.id = a.doc_type_id AND s.doc_class = t.doc_class AND s.slot = a.slot AND a.company_id = :'company_id';")
L.append('-- เส้นทางสมุดรายวัน (ISINFO.*JNL) — ต้องสร้าง gl_journal_book 00–04 ก่อน')
for k, code in JR:
    L.append(f"INSERT INTO gl_journal_route(company_id, txn_kind, journal_book_id) SELECT :'company_id', {q(k)}, id FROM gl_journal_book WHERE company_id = :'company_id' AND code = {q(code)} ON CONFLICT DO NOTHING;")
L.append('COMMIT;')
open(os.path.join(OUT, 'seed_company_template.sql'), 'w').write('\n'.join(L) + '\n')
json.dump({'rules': R, 'slots': SLOT, 'roles': ROLES}, open(os.path.join(os.path.dirname(__file__), 'posting_rules.json'), 'w'), ensure_ascii=False, indent=1)
print('rules', len(R), 'settings', len(SETTINGS))
