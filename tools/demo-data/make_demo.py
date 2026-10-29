# -*- coding: utf-8 -*-
"""
แปลงข้อมูลที่นำเข้าจาก Express ให้เป็น "ข้อมูลตัวอย่างสมมุติ ปี 2568–2569" สำหรับสาธิตและทดสอบ Buddy Account

ใช้:  python3 tools/demo-data/make_demo.py <DATABASE_URL> <รหัสบริษัทที่นำเข้า> [รหัสบริษัทใหม่=DEMO] [--years 16]
      รันบนฐานข้อมูลที่เพิ่งนำเข้าจาก Express เท่านั้น (สคริปต์แก้ข้อมูลในที่ — รันซ้ำบนบริษัทเดิมไม่ได้)

ทำอะไรบ้าง
 1. เลื่อนวันที่ทุกช่อง +16 ปี (2552–2553 → 2568–2569) — 16 หารด้วย 4 ลงตัว วันที่ 29 ก.พ. จึงไม่เพี้ยน
    เลขที่เอกสารที่มีปี พ.ศ. 2 หลักฝังอยู่ (เช่น JV520101001, PI520722001) เลื่อนปีตามด้วย
 2. วันที่ผิดในข้อมูลเดิม (ปี 1900, 4682 ฯลฯ) แก้เป็นวันที่สมเหตุสมผล และลบปีบัญชีปลอมที่เกิดจากวันที่ผิด
 3. ชื่อ ที่อยู่ โทรศัพท์ ผู้ติดต่อ ของบริษัท ลูกค้า ผู้จำหน่าย พนักงานขาย → ข้อมูลสมมุติ
    ชื่อเดิมที่อยู่ในคำอธิบายรายการถูกแทนด้วยชื่อใหม่
 4. เลขประจำตัวผู้เสียภาษี: ทุกรายในไทยได้เลข 13 หลักที่ผ่าน check digit (แทนเลข 10 หลักแบบเก่า/เลขว่าง)
    สาขา 5 หลัก (00000 = สำนักงานใหญ่) — ผู้ซื้อ/ผู้ขายต่างประเทศไม่มีเลข
    เลขสมมุติขึ้นต้น 0-0000 (นิติบุคคล) และ 1-0000 (บุคคลธรรมดา) เพื่อไม่ให้ตรงกับเลขจริง
 5. แฟ้มภาษีซื้อ/ขาย และ 50 ทวิ: เติมชื่อ เลขผู้เสียภาษี สาขา จากคู่ค้าของเอกสาร (ข้อมูลเดิมว่างเกือบทั้งหมด)
 6. เลขบัญชีธนาคารในบัญชีเงินฝากและชื่อผังบัญชี → เลขสมมุติ
 7. งวดบัญชี: ปี 2568 ปิดทั้งปี, ปี 2569 ปิดถึง ก.ย. เปิด ต.ค.–ธ.ค. สำหรับทดลองบันทึก
ยอดเงินทุกตัวไม่เปลี่ยน — งบทดลอง ลูกหนี้ เจ้าหนี้ สต๊อก ยังกระทบกับ Express ได้เหมือนเดิม
"""
import sys, re, hashlib, json, random
import psycopg2

args = [a for a in sys.argv[1:] if not a.startswith('--')]
DSN, SRC_CODE = args[0], args[1]
NEW_CODE = args[2] if len(args) > 2 else 'DEMO'
YEARS = int(sys.argv[sys.argv.index('--years') + 1]) if '--years' in sys.argv else 16

conn = psycopg2.connect(DSN); conn.autocommit = False
cur = conn.cursor()
def q(sql, *a): cur.execute(sql, a); return cur.fetchall() if cur.description else None
def x(sql, *a): cur.execute(sql, a); return cur.rowcount
report = {}

cur.execute("SET session_replication_role = replica")   # ปิด trigger (ตรวจงวด/log) ระหว่างแปลงข้อมูล
row = q("SELECT id FROM sys_company WHERE code = %s AND deleted_at IS NULL", SRC_CODE)
if not row: sys.exit(f'ไม่พบบริษัทรหัส {SRC_CODE}')
CID = row[0][0]
if q("SELECT 1 FROM sys_company WHERE code = %s AND id <> %s", NEW_CODE, CID): sys.exit(f'รหัสบริษัท {NEW_CODE} มีอยู่แล้ว')

def h(*p):  # ตัวเลขสุ่มแบบกำหนดได้ (รันซ้ำได้ผลเดิม)
    return int(hashlib.sha256('/'.join(map(str, p)).encode()).hexdigest(), 16)

def check_digit(d12):
    return (11 - sum(int(d12[i]) * (13 - i) for i in range(12)) % 11) % 10

def fake_tax_id(kind, key):
    body = ('0000' if kind == 'J' else '1000') + str(h('tax', key) % 10**8).zfill(8)
    return body + str(check_digit(body))

# ------------------------------------------------------------------ 1–2 วันที่
date_cols = q("""SELECT c.table_name, c.column_name, c.is_nullable FROM information_schema.columns c
                   JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
                  WHERE c.table_schema = 'public' AND c.data_type = 'date' AND c.table_name NOT IN ('sys_session')""")
has_company = {t for (t,) in q("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id'")}
# วันที่ผิด: ก่อนปี 1990 หรือหลังปี 2030 (ก่อนเลื่อน)
fy_first = q("SELECT min(start_date) FROM gl_fiscal_year y WHERE company_id = %s AND EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = y.company_id AND j.voucher_date BETWEEN y.start_date AND y.end_date)", CID)[0][0]
fixed = 0
for t, c, nullable in date_cols:
    if t not in has_company or t in ('gl_fiscal_year', 'gl_period'): continue
    if t == 'fa_asset' and c in ('purchase_date', 'start_date'):
        fixed += x(f"UPDATE {t} SET {c} = '{fy_first}'::date WHERE company_id = %s AND ({c} > '2030-12-31')", CID)
        continue
    if nullable == 'YES':
        fixed += x(f"UPDATE {t} SET {c} = NULL WHERE company_id = %s AND ({c} < '1990-01-01' OR {c} > '2030-12-31')", CID)
    else:
        fixed += x(f"UPDATE {t} SET {c} = '{fy_first}'::date WHERE company_id = %s AND ({c} < '1990-01-01' OR {c} > '2030-12-31')", CID)
report['วันที่ผิดที่แก้'] = fixed
# ปีบัญชีปลอม: ปีหลังปีสุดท้ายที่มีใบสำคัญ เกิดจากพิมพ์ปีผิดในเอกสาร (เช่น 2556 2565 2573)
# ปีก่อนปีแรกที่มีใบสำคัญ (2550–2551) เป็นเอกสารยกมาจริง — เก็บไว้เป็นปีที่ปิดแล้ว
period_refs = [r for r in q("""SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
                    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                   WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'gl_period'""")]
last_real = q("""SELECT id, start_date, end_date FROM gl_fiscal_year y WHERE company_id = %s AND EXISTS
          (SELECT 1 FROM gl_journal j WHERE j.company_id = y.company_id AND j.voucher_date BETWEEN y.start_date AND y.end_date) ORDER BY start_date DESC LIMIT 1""", CID)[0]
junk = q("SELECT id, code FROM gl_fiscal_year WHERE company_id = %s AND start_date > %s", CID, last_real[2])
DATE_OF = {'doc_header': ['doc_date', 'vat_date', 'due_date'], 'tax_vat_entry': ['doc_date', 'tax_invoice_date'], 'tax_wht_entry': ['certificate_date']}
moved = 0
for fy, code in junk:
    for pid, pno in q("SELECT id, period_no FROM gl_period WHERE fiscal_year_id = %s", fy):
        target = q("SELECT id FROM gl_period WHERE fiscal_year_id = %s AND period_no = %s", last_real[0], pno)[0][0]
        for t, c in period_refs:
            if t == 'gl_period': continue
            for col in DATE_OF.get(t, []):   # พิมพ์ปีผิด: ใช้ปีสุดท้ายที่มีใบสำคัญ วัน/เดือนเดิม
                x(f"""UPDATE {t} SET {col} = make_date(extract(year from %s::date)::int, extract(month from {col})::int, least(extract(day from {col})::int, 28))
                      WHERE {c} = %s AND {col} > %s""", last_real[2], pid, last_real[2])
            moved += x(f"UPDATE {t} SET {c} = %s WHERE {c} = %s", target, pid)
    x("DELETE FROM gl_period WHERE fiscal_year_id = %s", fy); x("DELETE FROM gl_fiscal_year WHERE id = %s", fy)
report['ปีบัญชีปลอมที่ลบ'] = [c for _, c in junk]
report['รายการที่ย้ายจากปีปลอม'] = moved
shifted = 0
for t, c, _ in date_cols:
    if t not in has_company: continue
    shifted += x(f"UPDATE {t} SET {c} = ({c} + interval '{YEARS} years')::date WHERE company_id = %s AND {c} IS NOT NULL", CID)
x("UPDATE gl_fiscal_year SET code = 'T' || left(id::text, 8) WHERE company_id = %s", CID)
x("UPDATE gl_fiscal_year SET code = (extract(year from end_date)::int + 543)::text WHERE company_id = %s", CID)
report['ช่องวันที่ที่เลื่อน'] = shifted

# เลขที่เอกสารที่มีปี พ.ศ. 2 หลัก: prefix ตัวอักษร 2–3 ตัว + ปี (50–56) + เดือน 01–12
YY = re.compile(r'^([A-Z]{2,3})(5[0-6])(0[1-9]|1[0-2])')
def shift_no(s):
    if not s: return s
    m = YY.match(s)
    return s if not m else f"{m.group(1)}{(int(m.group(2)) + YEARS) % 100:02d}{m.group(3)}{s[m.end():]}"
renum = 0
for t, c in [('gl_journal', 'voucher_no'), ('gl_journal', 'reference'), ('doc_header', 'doc_no'), ('doc_header', 'ref_no'),
             ('tax_vat_entry', 'doc_no'), ('tax_vat_entry', 'tax_invoice_no'), ('tax_wht_entry', 'certificate_no')]:
    rows = q(f"SELECT id, {c} FROM {t} WHERE company_id = %s AND {c} ~ '^[A-Z]{{2,3}}5[0-6](0[1-9]|1[0-2])'", CID)
    for rid, v in rows:
        x(f"UPDATE {t} SET {c} = %s WHERE id = %s", shift_no(v), rid); renum += 1
report['เลขที่เอกสารที่เลื่อนปี'] = renum

# ------------------------------------------------------------------ 3–4 คู่ค้าสมมุติ
TH = re.compile('[฀-๿]')
JUR = re.compile(r'(บริษัท|บจก|หจก|ห้างหุ้นส่วน|จำกัด|มหาชน|co\.|ltd|llc|inc|gmbh|corp|limited|s\.a\.|b\.v\.|pte|company)', re.I)
W1 = ['ไทย', 'สยาม', 'ล้านนา', 'เชียงใหม่', 'ดอยคำ', 'ปิง', 'รุ่งเรือง', 'มั่นคง', 'เจริญ', 'สุขสวัสดิ์', 'ทองดี', 'ศรีสุข', 'นาคา', 'ฟ้าใส', 'ใบบุญ', 'แสงทอง', 'พรรณี', 'อุดม', 'นำชัย', 'ก้าวหน้า']
W2 = ['เทรดดิ้ง', 'ซัพพลาย', 'อินเตอร์', 'วู้ดเวิร์ค', 'เฟอร์นิเจอร์', 'แพคเกจจิ้ง', 'โลจิสติกส์', 'การช่าง', 'วัสดุ', 'เอ็นจิเนียริ่ง', 'ดีไซน์', 'คราฟท์', 'พาณิชย์', 'อุตสาหกรรม', 'ค้าไม้', 'การพิมพ์', 'ขนส่ง', 'เซอร์วิส', 'โฮม', 'เทกซ์ไทล์']
FN = ['สมชาย', 'สมหญิง', 'วิชัย', 'ศิริพร', 'ประเสริฐ', 'อรุณี', 'กิตติ', 'นภา', 'ธนพล', 'ปัทมา', 'สุรเชษฐ์', 'จิราพร', 'อนุชา', 'กมลวรรณ', 'ณัฐวุฒิ', 'พิมพ์ชนก', 'ชยพล', 'รัตนา', 'วรวุฒิ', 'สุนิสา']
LN = ['ใจดี', 'มีสุข', 'รักไทย', 'ศรีเมือง', 'บุญมา', 'แก้วกล้า', 'ทองคำ', 'สายบุญ', 'คงมั่น', 'พรหมมา', 'อินทร์แก้ว', 'วงศ์ใหญ่', 'ชัยมงคล', 'จันทร์เพ็ญ', 'สุวรรณ', 'เรืองศรี', 'นาคสุข', 'ปัญญาดี', 'ทิพย์มณี', 'ยอดยิ่ง']
EN1 = ['Northwind', 'Bluebird', 'Silverline', 'Oakridge', 'Harbor', 'Evergreen', 'Lumen', 'Meridian', 'Atlas', 'Pinecrest', 'Brightwater', 'Copperfield', 'Riverstone', 'Summit', 'Willow', 'Cedar', 'Horizon', 'Maple', 'Stonebridge', 'Tidewater']
EN2 = ['Home', 'Living', 'Interiors', 'Trading', 'Design', 'Imports', 'Furnishings', 'Studio', 'Collective', 'Supply', 'Goods', 'Retail', 'House', 'Market', 'Crafts']
EN3 = ['Co., Ltd.', 'LLC', 'Inc.', 'GmbH', 'Pty Ltd', 'Ltd.', 'B.V.', 'S.A.']
TAMBON = [('ศรีภูมิ', 'เมืองเชียงใหม่', 'เชียงใหม่', '50200'), ('ช้างคลาน', 'เมืองเชียงใหม่', 'เชียงใหม่', '50100'), ('หางดง', 'หางดง', 'เชียงใหม่', '50230'),
          ('สันทรายหลวง', 'สันทราย', 'เชียงใหม่', '50210'), ('ต้นเปา', 'สันกำแพง', 'เชียงใหม่', '50130'), ('สีลม', 'บางรัก', 'กรุงเทพมหานคร', '10500'),
          ('ลาดยาว', 'จตุจักร', 'กรุงเทพมหานคร', '10900'), ('บางนา', 'บางนา', 'กรุงเทพมหานคร', '10260'), ('ในเมือง', 'เมืองลำพูน', 'ลำพูน', '51000'), ('เวียง', 'เมืองเชียงราย', 'เชียงราย', '57000')]
CITIES = [('Copenhagen', 'Denmark'), ('London', 'United Kingdom'), ('Sydney', 'Australia'), ('Tokyo', 'Japan'), ('New York', 'USA'), ('Berlin', 'Germany'), ('Paris', 'France'), ('Singapore', 'Singapore'), ('Amsterdam', 'Netherlands'), ('Dubai', 'UAE')]

used_names = set()
def uniq(n, key):
    base, i = n, 2
    while n in used_names: n = f'{base} ({i})'; i += 1
    used_names.add(n); return n

def fake_party(kind, key, old_name):
    r = random.Random(h('party', kind, key))
    thai = bool(TH.search(old_name or ''))
    jur = bool(JUR.search(old_name or '')) or not thai
    if thai and jur:
        form = r.choice(['บริษัท {} {} จำกัด'] * 4 + ['ห้างหุ้นส่วนจำกัด {}{}'])
        name = uniq(form.format(r.choice(W1), r.choice(W2)), key)
        name_en = None
    elif thai:
        name = uniq(f"{r.choice(['นาย', 'นาง', 'นางสาว'])}{r.choice(FN)} {r.choice(LN)}", key)
        name_en = None
    else:
        name = uniq(f'{r.choice(EN1)} {r.choice(EN2)} {r.choice(EN3)}', key)
        name_en = name
    if thai:
        t = r.choice(TAMBON)
        addr = (f'{r.randint(1, 299)}/{r.randint(1, 99)} หมู่ {r.randint(1, 12)} ถนนตัวอย่าง', f'ตำบล{t[0]} อำเภอ{t[1]}', f'จังหวัด{t[2]}', t[3])
        phone = f'0{r.choice(["53", "2", "81", "89", "92"])}-{r.randint(100, 999)}-{r.randint(1000, 9999)}'
    else:
        c = r.choice(CITIES)
        addr = (f'{r.randint(1, 999)} Example Street', f'{c[0]}', c[1], f'{r.randint(10000, 99999)}')
        phone = f'+{r.randint(1, 99)} {r.randint(100, 999)} {r.randint(1000, 9999)}'
    contact = f'คุณ{r.choice(FN)}' if thai else r.choice(['Anna', 'James', 'Sofia', 'Kenji', 'Lukas', 'Emma', 'Noah', 'Mia'])
    tax = fake_tax_id('J' if jur else 'P', key) if thai else None
    return dict(name=name, name_en=name_en, addr=addr, phone=phone, contact=contact, tax_id=tax, branch='00000' if thai and jur else None, thai=thai)

name_map = {}
for tbl, kind in (('md_customer', 'C'), ('md_supplier', 'S')):
    rows = q(f"SELECT id, code, name FROM {tbl} WHERE company_id = %s", CID)
    n_missing = 0
    for pid, code, name in rows:
        if (name or '').startswith('[MISSING]') or not (name or '').strip():
            # รหัสที่ Express อ้างถึงแต่ไม่มีในแฟ้มหลัก: ตั้งชื่อให้ชัดว่าเป็นข้อมูลเดิมไม่สมบูรณ์ และปิดใช้งาน
            x(f"UPDATE {tbl} SET name = %s, status = 'I', tax_id = NULL WHERE id = %s", f"(ข้อมูลเดิมไม่สมบูรณ์) {code}", pid); n_missing += 1
            continue
        p = fake_party(kind, pid, name)
        if name and len(name.strip()) >= 4: name_map[name.strip()] = p['name']
        x(f"""UPDATE {tbl} SET name = %s, name_en = %s, title = NULL, address_1 = %s, address_2 = %s, address_3 = %s, zip_code = %s, phone = %s,
              contact = %s, tax_id = %s, tax_branch_no = %s {", email = NULL" if tbl == 'md_customer' else ''} WHERE id = %s""",
          p['name'], p['name_en'], *p['addr'], p['phone'], p['contact'], p['tax_id'], p['branch'], pid)
    report[f'{tbl} สมมุติ'] = len(rows) - n_missing
    report[f'{tbl} ข้อมูลเดิมไม่สมบูรณ์'] = n_missing
x("UPDATE md_customer_ship_to s SET address_1 = c.address_1, address_2 = c.address_2, address_3 = c.address_3, contact = c.contact, phone = c.phone FROM md_customer c WHERE c.id = s.customer_id AND s.company_id = %s", CID)
for pid, name in q("SELECT id, name FROM md_salesperson WHERE company_id = %s", CID):
    r = random.Random(h('slm', pid))
    new = f'{r.choice(FN)} {r.choice(LN)}'
    if name and len(name.strip()) >= 4: name_map[name.strip()] = new
    x("UPDATE md_salesperson SET name = %s, address = NULL, phone = %s, tax_id = %s, social_security_no = NULL WHERE id = %s",
      new, f'08{r.randint(1, 9)}-{r.randint(100, 999)}-{r.randint(1000, 9999)}', fake_tax_id('P', pid), pid)

# ชื่อคู่ค้าในเอกสาร (สำเนาที่หัวเอกสาร) ตามแฟ้มหลัก
x("""UPDATE doc_header h SET party_name = c.name, party_tax_id = c.tax_id,
       party_address = concat_ws(' ', c.address_1, c.address_2, c.address_3, c.zip_code) FROM md_customer c WHERE c.id = h.customer_id AND h.company_id = %s""", CID)
x("""UPDATE doc_header h SET party_name = s.name, party_tax_id = s.tax_id,
       party_address = concat_ws(' ', s.address_1, s.address_2, s.address_3, s.zip_code) FROM md_supplier s WHERE s.id = h.supplier_id AND h.company_id = %s""", CID)

# ------------------------------------------------------------------ 5 แฟ้มภาษี
n1 = x("""UPDATE tax_vat_entry v SET party_name = COALESCE(c.name, s.name), party_tax_id = COALESCE(c.tax_id, s.tax_id),
            party_tax_branch_no = COALESCE(c.tax_branch_no, s.tax_branch_no)
          FROM doc_header h LEFT JOIN md_customer c ON c.id = h.customer_id LEFT JOIN md_supplier s ON s.id = h.supplier_id
         WHERE h.id = v.header_id AND v.company_id = %s""", CID)
n2 = x("""UPDATE tax_vat_entry SET party_name = 'ผู้ขาย/ผู้ซื้อรายย่อย (ตัวอย่าง)', party_tax_id = NULL, party_tax_branch_no = NULL
         WHERE company_id = %s AND (header_id IS NULL OR party_name IS NULL OR party_name = '')""", CID)
report['แฟ้มภาษีซื้อ/ขาย เติมคู่ค้า'] = n1; report['แฟ้มภาษีที่ไม่มีเอกสารต้นทาง'] = n2
x("""UPDATE tax_wht_entry w SET payee_name = COALESCE(s.name, c.name), payee_tax_id = COALESCE(s.tax_id, c.tax_id), payee_tax_branch_no = COALESCE(s.tax_branch_no, c.tax_branch_no),
       payee_address = concat_ws(' ', COALESCE(s.address_1, c.address_1), COALESCE(s.address_2, c.address_2), COALESCE(s.address_3, c.address_3))
     FROM md_supplier s FULL JOIN md_customer c ON false WHERE (s.id = w.supplier_id OR c.id = w.customer_id) AND w.company_id = %s""", CID)
x("UPDATE fin_cheque SET payee_name = NULL WHERE company_id = %s", CID)

# ------------------------------------------------------------------ 6 เลขบัญชีธนาคาร
def mask_digits(s, key):
    if not s: return s
    r = random.Random(h('acct', key, s))
    return re.sub(r'\d{3,}(?:-\d+)+|\d{6,}', lambda m: re.sub(r'\d', lambda _: str(r.randint(0, 9)), m.group(0)), s)
for bid, num, name in q("SELECT id, account_number, name FROM md_bank_account WHERE company_id = %s", CID):
    x("UPDATE md_bank_account SET account_number = %s, name = %s WHERE id = %s", mask_digits(num, bid), mask_digits(name, bid), bid)
for aid, th, en in q("SELECT id, name_th, name_en FROM gl_account WHERE company_id = %s AND (name_th ~ '\\d{3,}' OR name_en ~ '\\d{3,}')", CID):
    x("UPDATE gl_account SET name_th = %s, name_en = %s WHERE id = %s", mask_digits(th, aid), mask_digits(en, aid), aid)
x("UPDATE gl_fs_line SET description_th = regexp_replace(description_th, '\\d{3}-\\d-\\d{5}-\\d', 'xxx-x-xxxxx-x', 'g') WHERE company_id = %s", CID)

# ชื่อเดิมในคำอธิบายรายการ → ชื่อสมมุติ
if name_map:
    keys = sorted(name_map, key=len, reverse=True)
    rx = re.compile('|'.join(re.escape(k) for k in keys))
    changed = 0
    for t, c in [('gl_journal', 'description'), ('gl_journal_line', 'description'), ('doc_header', 'remark'), ('tax_vat_entry', 'description')]:
        if not q("SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s", t, c): continue
        for rid, v in q(f"SELECT id, {c} FROM {t} WHERE company_id = %s AND {c} IS NOT NULL AND {c} <> ''", CID):
            nv = rx.sub(lambda m: name_map[m.group(0)], v)
            if nv != v: x(f"UPDATE {t} SET {c} = %s WHERE id = %s", nv[:200], rid); changed += 1
    report['คำอธิบายที่แทนชื่อ'] = changed

# ------------------------------------------------------------------ บริษัท
co_tax = fake_tax_id('J', 'company-' + NEW_CODE)
x("""UPDATE sys_company SET code = %s, name_th = %s, name_en = %s, address_th = %s, address_en = %s, phone = %s, tax_id = %s,
       trade_reg_no = %s, social_security_no = NULL WHERE id = %s""",
  NEW_CODE, 'บริษัท บัดดี้ ดีไซน์ (ตัวอย่าง) จำกัด', 'BUDDY DESIGN (DEMO) CO., LTD.',
  '99/9 หมู่ 1 ถนนตัวอย่าง ตำบลศรีภูมิ\nอำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200', '99/9 Moo 1, Example Road, Si Phum\nMueang Chiang Mai, Chiang Mai 50200',
  '053-000-000', co_tax, co_tax, CID)
x("UPDATE sys_branch SET tax_branch_no = '00000', address = NULL WHERE company_id = %s AND is_head_office", CID)
# บริษัทตัวอย่างอยู่ในลูกค้าผู้ใช้บริการ DEMO ของตัวเอง แยกจากข้อมูลลูกค้าจริง
t = q("SELECT id FROM sys_tenant WHERE code = 'DEMO' AND deleted_at IS NULL")
TID = t[0][0] if t else q("INSERT INTO sys_tenant (code, name, plan) VALUES ('DEMO', 'บริษัทตัวอย่าง (สาธิต)', 'demo') RETURNING id")[0][0]
x("UPDATE sys_company SET tenant_id = %s WHERE id = %s", TID, CID)
if not q("SELECT 1 FROM sys_user_group WHERE tenant_id = %s AND code = 'ADMIN'", TID):
    x("INSERT INTO sys_user_group (tenant_id, code, name) VALUES (%s, 'ADMIN', 'ผู้ดูแลระบบของลูกค้า')", TID)

# ------------------------------------------------------------------ 7 งวดบัญชี
years = q("SELECT id, code FROM gl_fiscal_year WHERE company_id = %s ORDER BY start_date", CID)
for i, (yid, code) in enumerate(years):
    last = i == len(years) - 1
    x("UPDATE gl_fiscal_year SET status = %s WHERE id = %s", 'O' if last else 'C', yid)
    x("UPDATE gl_period SET is_locked = (CASE WHEN %s THEN period_no <= 9 ELSE true END), locked_at = now() WHERE fiscal_year_id = %s", last, yid)
report['ปีบัญชี'] = [c for _, c in years]

cur.execute("SET session_replication_role = origin")
x("INSERT INTO sys_activity_log(company_id, module, action, detail) VALUES (%s, 'SYS', 'DEMO_DATA', %s)", CID, json.dumps({'from': SRC_CODE, 'years': YEARS, **{k: v for k, v in report.items() if not isinstance(v, list)}}, ensure_ascii=False))
conn.commit()

# ------------------------------------------------------------------ ตรวจผล
bad = q("""SELECT count(*) FROM (SELECT tax_id FROM md_customer WHERE company_id = %s UNION ALL SELECT tax_id FROM md_supplier WHERE company_id = %s) t
           WHERE tax_id IS NOT NULL AND (length(tax_id) <> 13 OR substr(tax_id, 13, 1)::int <> (11 - (
             SELECT sum(substr(tax_id, i, 1)::int * (14 - i)) FROM generate_series(1, 12) i)::int %% 11) %% 10)""", CID, CID)[0][0]
tb = q("""SELECT y.code, sum(l.debit), sum(l.credit) FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id
          JOIN gl_fiscal_year y ON y.company_id = j.company_id AND j.voucher_date BETWEEN y.start_date AND y.end_date
         WHERE j.company_id = %s AND j.doc_status = 'N' GROUP BY 1 ORDER BY 1""", CID)
report['ตรวจ: เลขผู้เสียภาษีที่ไม่ผ่าน check digit'] = bad
report['ตรวจ: เดบิต/เครดิตรายปี'] = [[c, str(d), str(cr)] for c, d, cr in tb]
report['ตรวจ: ลูกหนี้คงค้าง'] = str(q("SELECT sum(outstanding) FROM v_ar_outstanding WHERE company_id = %s", CID)[0][0])
report['บริษัทใหม่'] = {'code': NEW_CODE, 'tax_id': co_tax}
print(json.dumps(report, ensure_ascii=False, indent=1))
