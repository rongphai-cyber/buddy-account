# -*- coding: utf-8 -*-
"""
ย้ายข้อมูลจากโฟลเดอร์ข้อมูลบริษัทของโปรแกรม Express (.DBF FoxPro, codepage 874) เข้าฐานข้อมูลใหม่ (PostgreSQL)
ใช้:  python3 migrate_express.py <โฟลเดอร์ Express> <postgres DSN> [รหัสบริษัท]
- อ่าน DBF โดยตรง (ไม่ต้องติดตั้ง FoxPro/ODBC) แปลงภาษาไทยจาก cp874 เป็น UTF-8
- สร้าง UUID แบบกำหนดได้ (uuid5 จากรหัสเดิม) รันซ้ำได้ผลเหมือนเดิม
- รหัสที่อ้างถึงแต่ไม่มีในแฟ้มหลัก จะสร้างแถว placeholder (status='I', ชื่อ '[MISSING] …') และบันทึกในรายงานคุณภาพข้อมูล
"""
import os, sys, struct, uuid, json, re, collections, datetime
import psycopg2, psycopg2.extras

SRC = sys.argv[1]; DSN = sys.argv[2]; CO = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(SRC.rstrip('/'))
NS = uuid.uuid5(uuid.NAMESPACE_URL, 'express-migration/' + CO)
def U(*parts): return str(uuid.uuid5(NS, '/'.join(str(p) for p in parts)))
QUALITY = collections.defaultdict(list)

# ------------------------------------------------------------------ DBF reader
def dbf(name):
    path = os.path.join(SRC, name + '.DBF')
    if not os.path.exists(path): return
    f = open(path, 'rb'); h = f.read(32)
    n = struct.unpack('<I', h[4:8])[0]; hl, rl = struct.unpack('<HH', h[8:12])
    fields = []; off = 1
    while True:
        b = f.read(32)
        if not b or b[0] == 0x0D: break
        nm = b[:11].split(b'\0')[0].decode('ascii'); t = chr(b[11]); ln = b[16]
        fields.append((nm, t, off, ln)); off += ln
    f.seek(hl)
    for _ in range(n):
        r = f.read(rl)
        if len(r) < rl: break
        if r[:1] == b'*': continue           # deleted record
        o = {}
        for nm, t, of, ln in fields:
            raw = r[of:of+ln]
            if t in 'CM': v = raw.decode('cp874', 'replace').replace('\xa0', ' ').rstrip() or None
            elif t in 'NF':
                s = raw.decode('ascii', 'replace').strip()
                try: v = float(s) if s else None
                except ValueError: v = None
            elif t == 'D':
                s = raw.decode('ascii', 'replace').strip()
                try: v = datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8])) if s else None
                except ValueError: v = None
            elif t == 'L': v = raw.decode('ascii', 'replace') in ('T', 'Y')
            elif t == 'I': v = struct.unpack('<i', raw)[0]
            elif t == 'B': v = struct.unpack('<d', raw)[0]
            elif t == 'Y': v = struct.unpack('<q', raw)[0] / 10000
            else: v = None
            o[nm] = v
        yield o

def st(v): return v.strip() if isinstance(v, str) else v
def money(v): return round(v or 0.0, 2)
def qty(v): return round(v or 0.0, 4)

conn = psycopg2.connect(DSN); conn.autocommit = False
cur = conn.cursor()
cur.execute("SET session_replication_role = replica")   # ปิด trigger ระหว่างย้ายข้อมูล (ไม่สร้าง change log/ไม่ตรวจงวด)
COMPANY = U('company')

def insert(table, rows, cols=None):
    rows = list(rows)
    if not rows: return 0
    cols = cols or list(rows[0].keys())
    sql = f'INSERT INTO {table} ({",".join(cols)}) VALUES %s ON CONFLICT DO NOTHING'
    psycopg2.extras.execute_values(cur, sql, [tuple(r.get(c) for c in cols) for r in rows], page_size=2000)
    return len(rows)

def base(**kw):
    d = {'company_id': COMPANY}; d.update(kw); return d

counts = collections.OrderedDict()
def done(tbl, n, src=''): counts[tbl] = (counts.get(tbl, (0, ''))[0] + n, src)

# ------------------------------------------------------------------ company / periods
info = next(dbf('ISINFO'), {}) or {}
# ลูกค้าผู้ใช้บริการ (tenant): ใช้ BUDDY_TENANT (รหัส) ถ้ากำหนด ไม่งั้นใช้ลูกค้าเริ่มต้น DEFAULT
TENANT_CODE = os.environ.get('BUDDY_TENANT', 'DEFAULT')
cur.execute("SELECT id FROM sys_tenant WHERE code = %s AND deleted_at IS NULL", (TENANT_CODE,))
_t = cur.fetchone()
if _t: TENANT = _t[0]
else:
    cur.execute("INSERT INTO sys_tenant (code, name) VALUES (%s, %s) RETURNING id", (TENANT_CODE, 'ลูกค้าเริ่มต้น' if TENANT_CODE == 'DEFAULT' else TENANT_CODE)); TENANT = cur.fetchone()[0]
insert('sys_company', [{'id': COMPANY, 'tenant_id': TENANT, 'code': CO[:20], 'name_th': info.get('THINAM') or CO, 'name_en': info.get('ENGNAM'),
        'address_th': ' '.join(x for x in [info.get('ADDR01'), info.get('ADDR02')] if x), 'phone': info.get('TELNUM'),
        'tax_id': (info.get('TAXID') or '')[:13] or None, 'trade_reg_no': info.get('TRDREG'), 'year_system': 'B' if info.get('YEARTHAI') == '1' else 'C'}])
BRANCH = U('branch', 'HO')
insert('sys_branch', [base(id=BRANCH, code='HO', name='สำนักงานใหญ่', tax_branch_no='00000', is_head_office=True)])
done('sys_company', 1, 'ISINFO'); done('sys_branch', 1, '(สร้างใหม่)')

prd = next(dbf('ISPRD'), None)
PERIODS = []   # (start, end, id)
if prd:
    for suffix, yrkey in (('', 'CY'), ('NY', 'NY')):
        b1, e12 = prd.get(f'BEG1{suffix}'), prd.get(f'END12{suffix}')
        if not b1: continue
        fy = U('fy', b1.year); insert('gl_fiscal_year', [base(id=fy, code=str(b1.year + 543), start_date=b1, end_date=e12)]); done('gl_fiscal_year', 1, 'ISPRD')
        rows = []
        for i in range(1, 13):
            b, e = prd.get(f'BEG{i}{suffix}'), prd.get(f'END{i}{suffix}')
            pid = U('period', b); PERIODS.append((b, e, pid))
            rows.append(base(id=pid, fiscal_year_id=fy, period_no=i, start_date=b, end_date=e, is_locked=prd.get(f'LOCK{i}{suffix}') == 'Y'))
        done('gl_period', insert('gl_period', rows), 'ISPRD')
def period_of(d, create=True):
    if d is None: return None
    for b, e, pid in PERIODS:
        if b <= d <= e: return pid
    if not create: return None
    # วันที่อยู่นอกรอบบัญชี 24 งวดของ Express (ข้อมูลปีเก่า) → สร้างปี/งวดให้
    y = d.year; fy = U('fy', y)
    cur.execute('INSERT INTO gl_fiscal_year(id,company_id,code,start_date,end_date,status) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                (fy, COMPANY, str(y + 543), datetime.date(y, 1, 1), datetime.date(y, 12, 31), 'C'))
    for m in range(1, 13):
        b = datetime.date(y, m, 1); e = (datetime.date(y + (m == 12), m % 12 + 1, 1) - datetime.timedelta(days=1))
        pid = U('period', b)
        cur.execute('INSERT INTO gl_period(id,company_id,fiscal_year_id,period_no,start_date,end_date,is_locked) VALUES (%s,%s,%s,%s,%s,%s,true) ON CONFLICT DO NOTHING',
                    (pid, COMPANY, fy, m, b, e))
        PERIODS.append((b, e, pid))
    QUALITY['periods_created_for_old_years'].append(y)
    return period_of(d, False)

# ------------------------------------------------------------------ lookups (ISTAB)
TYPES = {'01':'ธนาคาร','02':'สถานะเช็ค','10':'สมุดรายวัน','20':'หน่วยนับ','21':'คลังสินค้า','22':'หมวดสินค้า','23':'ระดับสินค้า',
         '40':'เขตการขาย','41':'ขนส่งโดย','42':'เหตุผลยกเลิก (ขาย)','43':'เหตุผลยกเลิก (ซื้อ)','44':'สถานะใบเสนอราคา','45':'ประเภทลูกค้า',
         '46':'ประเภทผู้จำหน่าย','47':'ประเภทพนักงานขาย','50':'แผนก','51':'คำนำหน้าชื่อ','52':'หมวดทรัพย์สิน','53':'สถานะเงินสดย่อย','55':'แบบภาษีหัก ณ ที่จ่าย','60':'ฤดูกาล/Collection'}
insert('md_lookup_type', [{'id': U('lt', k), 'code': k, 'name_th': v} for k, v in TYPES.items()])
UNIT, WH, DEPT, BANK = {}, {}, {}, {}
lk_rows, seen = [], set()
for r in dbf('ISTAB'):
    tt, code = st(r['TABTYP']), st(r['TYPCOD'])
    if not tt or not code: continue
    name = r['TYPDES'] or r['SHORTNAM'] or code
    if tt == '20': UNIT[code] = U('unit', code); insert('md_unit', [base(id=UNIT[code], code=code, name_th=name[:60], name_en=(r['TYPDES2'] or '')[:60] or None)])
    elif tt == '21': WH[code] = U('wh', code); insert('md_warehouse', [base(id=WH[code], code=code, name_th=name, name_en=r['TYPDES2'], branch_id=BRANCH)])
    elif tt == '50': DEPT[code] = U('dept', code); insert('md_department', [base(id=DEPT[code], code=code, name_th=name, name_en=r['TYPDES2'], short_name_th=st(r.get('SHORTNAM')), short_name_en=st(r.get('SHORTNAM2')))])
    elif tt == '01': BANK[code] = U('bank', code); insert('md_bank', [base(id=BANK[code], code=code, name_th=name, name_en=r['TYPDES2'])])
    if (tt, code) in seen:
        n = 2
        while (tt, f'{code}-{n}') in seen: n += 1
        QUALITY['istab_duplicate_code_renamed'].append(f'{tt}/{code}->{code}-{n}'); code = f'{code}-{n}'
    seen.add((tt, code))
    lk_rows.append(base(id=U('lk', tt, code), type_code=tt, code=code, short_th=r['SHORTNAM'], short_en=r['SHORTNAM2'], name_th=name, name_en=r['TYPDES2'], rate=r['FLD02']))
done('md_lookup', insert('md_lookup', lk_rows), 'ISTAB')
done('md_unit', len(UNIT), 'ISTAB 20'); done('md_warehouse', len(WH), 'ISTAB 21'); done('md_department', len(DEPT), 'ISTAB 50'); done('md_bank', len(BANK), 'ISTAB 01')

def ref(cache, table, code, kind, **extra):
    """หา id ของรหัสในแฟ้มหลัก ถ้าไม่มีให้สร้าง placeholder"""
    code = st(code)
    if not code: return None
    if code in cache: return cache[code]
    i = U(kind, code); cache[code] = i
    row = base(id=i, code=code[:30]); row.update(extra)
    if table in ('md_unit', 'md_warehouse', 'md_department', 'md_item_account_group', 'md_item', 'md_asset_account_group', 'md_bank'):
        row.setdefault('name_th', f'[MISSING] {code}')
    else: row['name'] = f'[MISSING] {code}'
    if table not in ('md_unit',): row['status'] = 'I'
    insert(table, [row]); QUALITY[f'missing_{table}'].append(code)
    return i

# ------------------------------------------------------------------ chart of accounts
ACC, accs = {}, list(dbf('GLACC'))
for r in accs: ACC[st(r['ACCNUM'])] = U('acc', st(r['ACCNUM']))
rows = []
for r in accs:
    a = st(r['ACCNUM'])
    rows.append(base(id=ACC[a], account_no=a, name_th=r['ACCNAM'] or a, name_en=r['ACCNAM2'], parent_id=ACC.get(st(r['PARENT'])),
                     level=int(r['LEVEL'] or 1), account_group=r['GROUP'] if r['GROUP'] in '12345' and r['GROUP'] else '5',
                     is_control=r['ACCTYP'] == '1', normal_side='C' if r['NATURE'] == '1' else 'D', use_department=r['USEDEP'] == 'Y',
                     use_project=r['USEJOB'] == 'Y', status='A' if (r['STATUS'] or 'A') == 'A' else 'I'))
done('gl_account', insert('gl_account', rows), 'GLACC')
def acc(code):
    code = st(code)
    if not code: return None
    if code not in ACC:
        ACC[code] = U('acc', code); QUALITY['missing_gl_account'].append(code)
        insert('gl_account', [base(id=ACC[code], account_no=code, name_th=f'[MISSING] {code}', account_group='5', normal_side='D', status='I')])
    return ACC[code]

# ------------------------------------------------------------------ doc types / journals / payment methods (ISRUN)
JB, DT, PM, DTCLASS = {}, {}, {}, {}
run = list(dbf('ISRUN'))
for r in run:
    if st(r['DOCTYP']) == 'GL':
        c = st(r['DOCCOD']); JB[c] = U('jb', c)
        insert('gl_journal_book', [base(id=JB[c], code=c, prefix=st(r['PREFIX']), name_th=r['POSDES'], name_en=r['POSDES2'])])
done('gl_journal_book', len(JB), "ISRUN DOCTYP='GL'")
MODULE = {'OB':'IC','QT':'SO','SO':'SO','AI':'AR','IV':'AR','HS':'AR','DR':'AR','CN':'AR','OI':'AR','BS':'AR','RE':'AR',
          'PO':'PO','AE':'AP','RR':'AP','HP':'AP','CP':'AP','DN':'AP','OE':'AP','BR':'AP','PS':'AP',
          'OU':'IC','RL':'IC','JU':'IC','CA':'IC','BD':'BK','BW':'BK','BT':'BK','BU':'BK','BV':'BK','BQ':'BK','QP':'BK','DP':'PC','VR':'PC'}
dt_rows, dta_rows, pm_rows = [], [], []
for r in run:
    typ, pre = st(r['DOCTYP']), st(r['PREFIX'])
    if not typ or not pre or typ == 'GL': continue
    accts = [st(r[f'ACCNUM{i:02d}']) for i in range(1, 13)]
    if typ in ('ZR', 'ZP'):
        d = 'R' if typ == 'ZR' else 'P'
        if (d, pre) in PM: QUALITY['payment_method_duplicate'].append(f'{typ}/{pre}'); continue
        PM[(d, pre)] = U('pm', d, pre)
        nm = r['POSDES'] or pre
        kind = 'CHEQUE' if 'เช็ค' in nm else 'CASH' if 'เงินสด' in nm and 'ย่อย' not in nm else 'TRANSFER' if 'โอน' in nm else 'WHT' if 'หัก ณ' in nm or 'หัก\xa0ณ' in nm else 'DEPOSIT' if 'มัดจำ' in nm else 'OTHER'
        pm_rows.append(base(id=PM[(d, pre)], direction=d, code=pre, seq=st(r['DOCCOD']), name_th=nm, name_en=r['POSDES2'], kind=kind,
                            gl_account_id=acc(accts[0]), creates_cheque=kind in ('CHEQUE', 'TRANSFER')))
        continue
    if pre in DT: QUALITY['doc_type_duplicate_prefix'].append(pre); continue
    DT[pre] = U('dt', pre); DTCLASS[pre] = typ
    dt_rows.append(base(id=DT[pre], code=pre, doc_class=typ, module=MODULE.get(typ, 'GL'), name_th=r['POSDES'] or pre, name_en=r['POSDES2'],
                        short_name=st(r['SHORTNAM']), journal_book_id=JB.get(st(r['JNLTYP'])), journal_desc_template=r['JNLEXP'],
                        warehouse_id=WH.get(st(r['LOCCOD'])), price_type=r['FLGVAT'] if r['FLGVAT'] in ('0','1','2') else None, vat_rate=r['VATRAT'],
                        vat_basis=r['SRV_VATTYP'] if r['SRV_VATTYP'] in ('1','2','3') else None,
                        approve_method=r['APPROV_MET'], approve_level=int(r['APPROV_LEV']) if (r['APPROV_LEV'] or '').isdigit() else None,
                        reprint_level=int(r['REPRN_LEV']) if (r['REPRN_LEV'] or '').isdigit() else None,
                        is_tax_invoice=typ in ('IV', 'HS', 'DR', 'CN', 'AI', 'RE')))
    for i, a in enumerate(accts, 1):
        if a: dta_rows.append(base(id=U('dta', pre, i), doc_type_id=DT[pre], slot=i, account_id=acc(a)))
done('md_doc_type', insert('md_doc_type', dt_rows), 'ISRUN'); done('md_doc_type_account', insert('md_doc_type_account', dta_rows), 'ISRUN.ACCNUMxx')
done('md_payment_method', insert('md_payment_method', pm_rows), "ISRUN DOCTYP='ZR'/'ZP'")
def doc_type(docnum, fallback_class):
    pre = (docnum or '')[:2]
    if pre in DT: return DT[pre], DTCLASS[pre]
    DT[pre] = U('dt', pre); DTCLASS[pre] = fallback_class; QUALITY['doc_type_created_for_prefix'].append(pre)
    insert('md_doc_type', [base(id=DT[pre], code=pre or '??', doc_class=fallback_class, module=MODULE.get(fallback_class, 'GL'), name_th=f'[MISSING] {pre}', status='I')])
    return DT[pre], fallback_class

# ------------------------------------------------------------------ default accounts / journal routes (ISINFO)
ROLES = ['CASH','PETTY_CASH_UNUSED','AR','CHEQUE_RECEIVED','INVENTORY','PREPAID_TAX','INPUT_VAT','AP','CHEQUE_PAID','WHT_PAYABLE','OUTPUT_VAT',
         'CASH_SALES','CREDIT_SALES','SALES_RETURN','SALES_DISCOUNT','INTEREST_INCOME','BANK_INCOME','COGS','PURCHASES','PURCHASE_RETURN',
         'PURCHASE_DISCOUNT','INTEREST_EXPENSE','BANK_CHARGE','RETAINED_EARNINGS','SUSPENSE','BAD_DEBT','OTHER_INCOME','OUTPUT_VAT_PENDING',
         'INPUT_VAT_PENDING','OTHER_EXPENSE','DEPOSIT_PAID','DEPOSIT_RECEIVED','PETTY_CASH','INPUT_VAT_NONCLAIM','INPUT_VAT_UNCLAIMABLE']
rows = []
for i, role in enumerate(ROLES):
    a = st(info.get(f'ACCNUM{i:02d}'))
    if a: rows.append(base(id=U('gda', role), role=role, account_id=acc(a)))
done('gl_default_account', insert('gl_default_account', rows), 'ISINFO.ACCNUM00–34')
JR = {'CSHPURJNL':'CASH_PURCHASE','CREPURJNL':'CREDIT_PURCHASE','PURRETJNL':'PURCHASE_RETURN','OTHEXPJNL':'OTHER_EXPENSE','APRCPJNL':'AP_PAYMENT',
      'PASPCQJNL':'PASS_CHEQUE_PAID','CSHSALJNL':'CASH_SALE','CRESALJNL':'CREDIT_SALE','SALRETJNL':'SALES_RETURN','OTHINCJNL':'OTHER_INCOME',
      'ARRCPJNL':'AR_RECEIPT','PASRCQJNL':'PASS_CHEQUE_RCV','INTISSJNL':'INTERNAL_ISSUE','TAKADJJNL':'STOCK_COUNT_ADJ','COSADJJNL':'COST_ADJ',
      'BADDBTJNL':'BAD_DEBT','BNKMOVJNL':'BANK_MOVEMENT','INCCHQJNL':'CHEQUE_EXCESS_INCOME','EXPCHQJNL':'CHEQUE_EXCESS_EXPENSE',
      'ARADVJNL':'AR_DEPOSIT','APADVJNL':'AP_DEPOSIT','FADPRJNL':'DEPRECIATION','ARDNJNL':'AR_DEBIT_NOTE','APCNJNL':'AP_CREDIT_NOTE'}
rows = [base(id=U('jr', k), txn_kind=v, journal_book_id=JB[st(info[k])]) for k, v in JR.items() if st(info.get(k)) in JB]
done('gl_journal_route', insert('gl_journal_route', rows), 'ISINFO.*JNL')

# ------------------------------------------------------------------ account groups (ISACC)
IAG, AAG = {}, {}
for r in dbf('ISACC'):
    c = st(r['ACCCOD'])
    if r['ACCTYP'] == 'S':
        IAG[c] = U('iag', c)
        insert('md_item_account_group', [base(id=IAG[c], code=c, name_th=r['ACCDES'] or c, name_en=r['ACCDES2'],
               cost_method=r['METHOD'] if r['METHOD'] in ('F', 'A') else None,
               inventory_account_id=acc(r['ACCNUM01']), cogs_account_id=acc(r['ACCNUM02']), sales_account_id=acc(r['ACCNUM03']),
               sales_return_account_id=acc(r['ACCNUM04']), purchase_account_id=acc(r['ACCNUM05']), purchase_return_account_id=acc(r['ACCNUM06']))])
    else:
        AAG[c] = U('aag', c)
        insert('md_asset_account_group', [base(id=AAG[c], code=c, name_th=r['ACCDES'] or c, name_en=r['ACCDES2'],
               asset_account_id=acc(r['ACCNUM01']), depr_expense_account_id=acc(r['ACCNUM02']), accum_depr_account_id=acc(r['ACCNUM03']))])
done('md_item_account_group', len(IAG), "ISACC 'S'"); done('md_asset_account_group', len(AAG), "ISACC 'F'")

# ------------------------------------------------------------------ parties
SLM, CUS, SUP, ITEM, SHIP, BKA = {}, {}, {}, {}, {}, {}
rows = []
for r in dbf('OESLM'):
    c = st(r['SLMCOD']); SLM[c] = U('slm', c)
    rows.append(base(id=SLM[c], code=c, name=r['SLMNAM'] or c, position=r['POSITN'], salesperson_type=st(r['SLMTYP']), sales_area_code=st(r['AREACOD']),
                     commission_rate=r['COMRATE'], address=' '.join(x for x in [r['ADDR01'], r['ADDR02'], r['ADDR03']] if x) or None,
                     phone=r['TELNUM'], tax_id=(r['TAXID'] or '')[:13] or None, social_security_no=r['SOCIALID']))
done('md_salesperson', insert('md_salesperson', rows), 'OESLM')
def nz(v): return v if v else None
rows = []
for r in dbf('ARMAS'):
    c = st(r['CUSCOD']); CUS[c] = U('cus', c)
    rows.append(base(id=CUS[c], code=c, customer_type=st(r['CUSTYP']), title=r['PRENAM'], name=r['CUSNAM'] or c, name_en=r['CUSNAM2'],
                     address_1=r['ADDR01'], address_2=r['ADDR02'], address_3=r['ADDR03'], zip_code=st(r['ZIPCOD']), phone=r['TELNUM'], contact=r['CONTACT'],
                     tax_id=(st(r['TAXID']) or '')[:13] or None, salesperson_id=SLM.get(st(r['SLMCOD'])) or ref(SLM, 'md_salesperson', r['SLMCOD'], 'slm'),
                     sales_area_code=st(r['AREACOD']), ship_via_code=st(r['DLVBY']), credit_days=int(r['PAYTRM']) if r['PAYTRM'] else None,
                     payment_terms=r['PAYCOND'], price_level=r['TABPR'], discount_text=st(r['DISC']), credit_limit=nz(r['CRLINE']),
                     ar_account_id=acc(r['ACCNUM']), wht_form=st(r['TAXTYP']), wht_rate=r['TAXRAT'], remark=r['REMARK'],
                     status='I' if r['STATUS'] == 'I' else 'A', inactive_date=r['INACTDAT']))
done('md_customer', insert('md_customer', rows), 'ARMAS')
rows = []
for r in dbf('ARSHIP'):
    cc = st(r['CUSCOD']); cid = None if cc == '@@@@@@@@@@' else (CUS.get(cc) or ref(CUS, 'md_customer', cc, 'cus'))
    sid = U('ship', cc, st(r['SHIPTO'])); SHIP[(cc, st(r['SHIPTO']))] = sid
    rows.append(base(id=sid, customer_id=cid, code=st(r['SHIPTO']), address_1=r['ADDR01'], address_2=r['ADDR02'], address_3=r['ADDR03'],
                     zip_code=st(r['ZIPCOD']), phone=r['TELNUM'], contact=r['CONTACT']))
done('md_customer_ship_to', insert('md_customer_ship_to', rows), 'ARSHIP')
rows = []
for r in dbf('APMAS'):
    c = st(r['SUPCOD']); SUP[c] = U('sup', c)
    rows.append(base(id=SUP[c], code=c, supplier_type=st(r['SUPTYP']), title=r['PRENAM'], name=r['SUPNAM'] or c, name_en=r['SUPNAM2'],
                     address_1=r['ADDR01'], address_2=r['ADDR02'], address_3=r['ADDR03'], zip_code=st(r['ZIPCOD']), phone=r['TELNUM'], contact=r['CONTACT'],
                     tax_id=(st(r['TAXID']) or '')[:13] or None, price_type=r['FLGVAT'] if r['FLGVAT'] in ('0','1','2') else None, vat_rate=r['VATRAT'],
                     ship_via_code=st(r['DLVBY']), credit_days=int(r['PAYTRM']) if r['PAYTRM'] else None, payment_terms=r['PAYCOND'],
                     discount_text=st(r['DISC']), credit_limit=nz(r['CRLINE']), ap_account_id=acc(r['ACCNUM']), wht_form=st(r['TAXTYP']),
                     wht_income_desc=r['TAXDES'], wht_rate=r['TAXRAT'], wht_condition=st(r['TAXCOND']), on_hold=r['ONHOLD'] == 'Y',
                     remark=r['REMARK'], status='I' if r['STATUS'] == 'I' else 'A', inactive_date=r['INACTDAT']))
done('md_supplier', insert('md_supplier', rows), 'APMAS')
cus = lambda c: CUS.get(st(c)) or ref(CUS, 'md_customer', c, 'cus')
sup = lambda c: SUP.get(st(c)) or ref(SUP, 'md_supplier', c, 'sup')
slm = lambda c: SLM.get(st(c)) or ref(SLM, 'md_salesperson', c, 'slm')
unit = lambda c: UNIT.get(st(c)) or ref(UNIT, 'md_unit', c, 'unit')
wh = lambda c: WH.get(st(c)) or ref(WH, 'md_warehouse', c, 'wh')
dept = lambda c: DEPT.get(st(c)) or ref(DEPT, 'md_department', c, 'dept')

rows = []
for r in dbf('BKMAS'):
    c = st(r['BNKACC']); BKA[c] = U('bka', c)
    rows.append(base(id=BKA[c], code=c, name=r['BNKNAM'] or c, branch=r['BRANCH'], short_name=r['SHORTNAM'], account_number=st(r['BNKNUM']),
                     account_kind=c[:1] if c[:1] in 'CSF' else None, gl_account_id=acc(r['ACCNUM']), opening_balance=r['BALFWD'], opening_date=r['BALDAT']))
done('md_bank_account', insert('md_bank_account', rows), 'BKMAS')

# ------------------------------------------------------------------ items
items = list(dbf('STMAS'))
_c = collections.Counter(st(r['STKCOD']) for r in items)
QUALITY['stmas_duplicate_code_skipped'].extend(k for k, v in _c.items() if v > 1)
for r in items: ITEM[st(r['STKCOD'])] = U('item', st(r['STKCOD']))
ITYPE = {st(r['STKCOD']): r['STKTYP'] for r in items}
item = lambda c: ITEM.get(st(c)) or ref(ITEM, 'md_item', c, 'item', name_th=f'[MISSING] {st(c)}', item_type='0') if st(c) else None
rows = []
for r in items:
    c = st(r['STKCOD'])
    rows.append(base(id=ITEM[c], code=c, item_type=r['STKTYP'] if r['STKTYP'] in ('0','1','2','3','4','5') else '0', barcode=st(r['BARCOD']),
                     name_th=r['STKDES'] or c, name_en=r['STKDES2'], item_level=st(r['STKLEV']), category_code=st(r['STKGRP']),
                     account_group_id=IAG.get(st(r['ACCCOD'])) or (ref(IAG, 'md_item_account_group', r['ACCCOD'], 'iag') if st(r['ACCCOD']) else None),
                     base_unit_id=unit(r['QUCOD']), count_unit_id=unit(r['CQUCOD']), count_factor=nz(r['CFACTOR']),
                     purchase_unit_id=unit(r['PQUCOD']), purchase_factor=r['PFACTOR'] or 1, sales_unit_id=unit(r['SQUCOD']), sales_factor=r['SFACTOR'] or 1,
                     std_cost=nz(r['STNPR']), price_1=nz(r['SELLPR1']), price_2=nz(r['SELLPR2']), price_3=nz(r['SELLPR3']), price_4=nz(r['SELLPR4']), price_5=nz(r['SELLPR5']),
                     vat_code=st(r['VATCOD']), allow_negative=st(r['NEGALLOW']), default_supplier_id=sup(r['SUPCOD']) if st(r['SUPCOD']) else None,
                     packing=r['PACKING'], udf_1=st(r['STR1']), udf_2=st(r['STR2']), udf_3=st(r['STR3']), udf_4=(r['STR4'] or '')[:30] or None,
                     udf_date_1=r['DAT1'], remark=r['REMARK'], status='I' if r['STATUS'] == 'I' else 'A', inactive_date=r['INACTDAT']))
done('md_item', insert('md_item', rows), 'STMAS')
rows = [base(id=U('bom', st(r['PSTKCOD']), st(r['SEQNUM'])), parent_item_id=item(r['PSTKCOD']), line_no=int(st(r['SEQNUM']) or 0),
             component_item_id=item(r['STKCOD']), qty=r['BOMQTY'] or 0, std_cost=r['STNPR'], sell_price=r['SELLPR'], warehouse_id=wh(r['LOCCOD']) if st(r['LOCCOD']) else None)
        for r in dbf('STBOM')]
done('md_item_bom', insert('md_item_bom', rows), 'STBOM')

# ------------------------------------------------------------------ document headers
HDR = {}    # docnum -> (id, class, module)
def hdr_row(docnum, typ_fallback, module, d, force_class=None, **kw):
    dtid, dclass = doc_type(docnum, typ_fallback)
    if force_class and force_class != dclass:
        QUALITY['doc_class_from_rectype_differs_from_prefix'].append(f'{docnum}:{dclass}->{force_class}'); dclass = force_class
    hid = U('doc', module, docnum); HDR[(module, docnum)] = hid; HDR.setdefault(('*', docnum), hid)
    row = base(id=hid, branch_id=BRANCH, doc_type_id=dtid, doc_class=dclass, module=module, doc_no=docnum, doc_date=d or datetime.date(1900, 1, 1),
               period_id=period_of(d))
    row.update(kw); return row
def status(v): return v if v in ('N', 'M', 'C') else 'N'
RECTYP_AR = {'0': 'AI', '1': 'HS', '3': 'IV', '4': 'DR', '5': 'CN', '7': 'OI', '9': 'RE'}
RECTYP_AP = {'0': 'AE', '1': 'HP', '3': 'RR', '4': 'CP', '5': 'DN', '7': 'OE', '9': 'PS'}
def trn_rows(table, module, rmap, party):
    out = []
    for r in dbf(table):
        dn = st(r['DOCNUM'])
        p = {'customer_id': cus(r['CUSCOD'])} if party == 'C' else {'supplier_id': sup(r['SUPCOD'])}
        out.append(hdr_row(dn, rmap.get(r['RECTYP'], 'IV'), module, r['DOCDAT'], force_class=rmap.get(r['RECTYP']), express_rectype=r['RECTYP'], **p,
            salesperson_id=slm(r['SLMCOD']) if st(r.get('SLMCOD')) else None, department_id=dept(r['DEPCOD']) if st(r.get('DEPCOD')) else None,
            sales_area_code=st(r.get('AREACOD')), ship_via_code=st(r.get('DLVBY')), your_ref=r.get('YOUREF'), ref_no=st(r.get('REFNUM')),
            credit_days=int(r['PAYTRM']) if r.get('PAYTRM') else None, due_date=r.get('DUEDAT'),
            price_type=r['FLGVAT'] if r.get('FLGVAT') in ('0', '1', '2') else '0',
            amount=money(r.get('AMOUNT')), discount_text=st(r.get('DISC')), discount_amount=money(r.get('DISCAMT')), amount_after_discount=money(r.get('AFTDISC')),
            deposit_amount=money(r.get('ADVAMT')), zero_rate_amount=money(r.get('AMTRAT0')), taxable_amount=money(r.get('TOTAL')),
            vat_rate=r.get('VATRAT'), vat_amount=money(r.get('VATAMT')), net_amount=money(r.get('NETAMT')), wht_amount=money(r.get('TAX')),
            cash_amount=money(r.get('CSHRCV') or r.get('CSHPAY')), cheque_amount=money(r.get('CHQRCV') or r.get('CHQPAY')),
            interest_amount=money(r.get('INTRCV') or r.get('INTPAY')), settled_amount=money(r.get('RCVAMT') if party == 'C' else r.get('PAYAMT')),
            outstanding_amount=money(r.get('REMAMT')), commission_amount=money(r.get('COMAMT')),
            vat_basis=r['SRV_VATTYP'] if r.get('SRV_VATTYP') in ('1', '2', '3') else None, vat_date=r.get('VATDAT'),
            vat_period_id=period_of(r.get('VATPRD')) if r.get('VATPRD') else None, vat_late=r.get('VATLATE') == 'Y',
            doc_status=status(r.get('DOCSTAT')), is_settled=r.get('CMPLAPP') == 'Y', settled_date=r.get('CMPLDAT'),
            gl_posted='Y' if r.get('POSTGL') == 'Y' else 'N', print_count=int(r['PRNCNT'] or 0) if r.get('PRNCNT') else 0))
        if r.get('SONUM') and st(r['SONUM']): LINKS.append((st(r['SONUM']), dn, 'FULFIL', None, module))
        if r.get('PONUM') and st(r['PONUM']) and st(r['PONUM']) != 'PO...': LINKS.append((st(r['PONUM']), dn, 'FULFIL', None, module))
        adv = st(r.get('ADVNUM'))
        if adv and len(adv) > 3 and not adv.endswith('...'): LINKS.append((adv, dn, 'DEPOSIT', r.get('ADVAMT'), module))
        bil = st(r.get('BILNUM'))
        if bil and bil != '~': BILLS.append((bil, dn, module, r.get('NETAMT')))
    return out
LINKS, BILLS = [], []
done('doc_header', insert('doc_header', trn_rows('ARTRN', 'AR', RECTYP_AR, 'C')), 'ARTRN')
done('doc_header', insert('doc_header', trn_rows('APTRN', 'AP', RECTYP_AP, 'S')), 'APTRN')
rows = []
for r in dbf('OESO'):
    dn = st(r['SONUM'])
    rows.append(hdr_row(dn, 'QT' if r['SORECTYP'] == '5' else 'SO', 'SO', r['SODAT'], express_rectype=r['SORECTYP'], customer_id=cus(r['CUSCOD']),
        salesperson_id=slm(r['SLMCOD']) if st(r['SLMCOD']) else None, department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
        sales_area_code=st(r['AREACOD']), ship_via_code=st(r['DLVBY']), your_ref=r['YOUREF'], credit_days=int(r['PAYTRM']) if r['PAYTRM'] else None,
        delivery_date=r['DLVDAT'], delivery_date_per_line=r['DLVDAT_IT'] == 'Y', price_type=r['FLGVAT'] if r['FLGVAT'] in ('0','1','2') else '0',
        amount=money(r['AMOUNT']), taxable_amount=money(r['TOTAL']), vat_rate=r['VATRAT'], vat_amount=money(r['VATAMT']), net_amount=money(r['NETAMT']),
        doc_status=status(r['DOCSTAT']), settled_date=r['CMPLDAT'], is_settled=r['DOCSTAT'] == 'M'))
done('doc_header', insert('doc_header', rows), 'OESO')
rows = []
for r in dbf('POPR'):
    dn = st(r['PONUM'])
    rows.append(hdr_row(dn, 'PO', 'PO', r['PODAT'], express_rectype=r['PORECTYP'], supplier_id=sup(r['SUPCOD']),
        department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None, your_ref=r['YOUREF'], credit_days=int(r['PAYTRM']) if r['PAYTRM'] else None,
        delivery_date=r['RCVDAT'], delivery_date_per_line=r['RCVDAT_IT'] == 'Y', price_type=r['FLGVAT'] if r['FLGVAT'] in ('0','1','2') else '0',
        amount=money(r['AMOUNT']), discount_text=st(r['DISC']), discount_amount=money(r['DISCAMT']), taxable_amount=money(r['TOTAL']),
        vat_rate=r['VATRAT'], vat_amount=money(r['VATAMT']), net_amount=money(r['NETAMT']), doc_status=status(r['DOCSTAT']), settled_date=r['CMPLDAT'],
        is_settled=r['DOCSTAT'] == 'M', print_count=int(r['PRNCNT'] or 0)))
done('doc_header', insert('doc_header', rows), 'POPR')
STTRN_CLASS = {'4': 'RL', '5': 'CA', '6': 'OU', '8': 'JU', ':': 'JU'}
rows = []
for r in dbf('STTRN'):
    dn = st(r['DOCNUM'])
    rows.append(hdr_row(dn, STTRN_CLASS.get(r['POSOPR'], 'JU'), 'IC', r['DOCDAT'], express_rectype=r['POSOPR'], warehouse_id=wh(r['LOCCOD']),
        to_warehouse_id=wh(r['PEOPLE']) if r['POSOPR'] == '4' and st(r['PEOPLE']) else None, department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
        remark=r['REMARK'], ref_no=st(r['REFNUM']), ref_date=r['REFDAT'], net_amount=money(r['TRNVAL']), doc_status=status(r['DOCSTAT']),
        gl_posted='Y' if r['POSTGL'] == 'Y' else 'N', print_count=int(r['PRNCNT'] or 0) if r['PRNCNT'] else 0))
done('doc_header', insert('doc_header', rows), 'STTRN')
for table, module, party in (('ARBIL', 'AR', 'C'), ('APBIL', 'AP', 'S')):
    rows = []
    for r in dbf(table):
        dn = st(r['BILNUM'])
        p = {'customer_id': cus(r['CUSCOD'])} if party == 'C' else {'supplier_id': sup(r['SUPCOD'])}
        rows.append(hdr_row(dn, 'BS' if party == 'C' else 'BR', module, r['BILDAT'], **p, appointment_date=r['APPDAT'], payment_terms=r['PAYCOND'],
                            remark=r['REMARK'], net_amount=money(r['NETAMT']), doc_status=status(r['DOCSTAT']), print_count=int(r['PRNCNT'] or 0) if r['PRNCNT'] else 0))
    done('doc_header', insert('doc_header', rows), table)
rows = []
for r in dbf('GLPTT'):
    dn = st(r['DOCNUM'])
    rows.append(hdr_row(dn, 'VR' if r['RECTYP'] == '0' else 'DP', 'PC', r['DOCDAT'], express_rectype=r['RECTYP'], remark=r['REMARK'],
                        net_amount=money(r['AMOUNT']), cheque_amount=money(r['CHQAMT']), ref_no=st(r['REFNUM']), doc_status=status(r['DOCSTAT'])))
done('doc_header', insert('doc_header', rows), 'GLPTT')

def H(docnum, module=None):
    d = st(docnum)
    if not d: return None
    if module and (module, d) in HDR: return HDR[(module, d)]
    return HDR.get(('*', d))

# links & bills
rows, miss = [], 0
for frm, to, typ, amt, module in LINKS:
    f, t = H(frm), H(to, module)
    if f and t: rows.append(base(id=U('link', frm, to, typ), from_header_id=f, to_header_id=t, link_type=typ, amount=money(amt) if amt else None))
    else: QUALITY['doc_link_target_missing'].append(f'{frm}->{to}')
done('doc_link', insert('doc_link', rows), 'ARTRN.SONUM/ADVNUM, APTRN.PONUM/ADVNUM')
rows = []
for bil, dn, module, amt in BILLS:
    b, i = H(bil, module), H(dn, module)
    if b and i: rows.append(base(id=U('bill', bil, dn), bill_header_id=b, invoice_header_id=i, amount=money(amt)))
    else: QUALITY['bill_missing'].append(bil)
done('doc_bill_item', insert('doc_bill_item', rows), 'ARTRN/APTRN.BILNUM')

# ------------------------------------------------------------------ synthetic headers (Express เก็บบางเอกสารเฉพาะบรรทัด เช่น ใบปรับปรุงจากการตรวจนับ TK)
SYN = collections.OrderedDict()
OPEN_DATE = (PERIODS[0][0] - datetime.timedelta(days=1)) if PERIODS else datetime.date(2000, 1, 1)
def stcrd_doc(r):
    dn = st(r['DOCNUM'])
    if dn: return dn
    return 'OB-' + str((r['DOCDAT'] or OPEN_DATE).year)   # ยอดยกมาสินค้ารายล็อต (Express ไม่มีเลขที่เอกสาร)
POS_CLASS = {'0': 'RR', '1': 'JU', '2': 'CN', '3': 'RL', '4': 'RL', '5': 'CA', '6': 'OU', '7': 'DN', '8': 'JU', '9': 'IV', ':': 'JU', '=': 'DR', '>': 'OE'}
for r in dbf('STCRD'):
    dn = stcrd_doc(r)
    if dn and not H(dn) and dn not in SYN:
        cls = 'OB' if dn.startswith('OB-') else POS_CLASS.get(st(r['POSOPR']) or '', 'JU')
        SYN[dn] = (r['DOCDAT'] or (OPEN_DATE if cls == 'OB' else None), cls, st(r['LOCCOD']))
for r in dbf('GLPTTIT'):
    dn = st(r['DOCNUM'])
    if dn and not H(dn) and dn not in SYN: SYN[dn] = (None, 'DP', None)
rows = []
for dn, (d, cls, loc) in SYN.items():
    module = MODULE.get(cls, 'IC'); module = 'IC' if cls in ('JU', 'RL', 'OU', 'CA') else module
    if cls == 'OB' and 'OB' not in DT:
        DT['OB'] = U('dt', 'OB'); DTCLASS['OB'] = 'OB'
        insert('md_doc_type', [base(id=DT['OB'], code='OB', doc_class='OB', module='IC', name_th='ยอดยกมาสินค้า (จากการย้ายข้อมูล)', name_en='Opening stock')])
    rows.append(hdr_row(dn, cls, module, d, warehouse_id=None if cls == 'OB' else WH.get(loc),
                        remark='[ยอดยกมาสินค้ารายล็อต]' if cls == 'OB' else '[สร้างจากบรรทัดรายการ — Express ไม่มีหัวเอกสาร]'))
    QUALITY['header_synthesized_from_lines'].append(dn)
done('doc_header', insert('doc_header', rows), 'สร้างจาก STCRD/GLPTTIT ที่ไม่มีหัวเอกสาร')

# ------------------------------------------------------------------ lines (STCRD + SO/PO items + petty cash)
# ผลต่อสต๊อกตาม POSOPR — ยืนยันกับ STLOC.LOCBAL ของข้อมูลจริง (ตรง 98.75%)
# 3 = โอนเข้าคลัง (LOCCOD = คลังปลายทาง), 4 = โอนออก, 8 = ปรับปรุงตามเครื่องหมายจำนวน, : = ปรับจากตรวจนับ (จำนวนเป็นบวกเสมอ)
EFFECT = {'0': 1, '1': 1, '2': 1, '3': 1, '4': -1, '5': 0, '6': -1, '7': -1, '8': 0, '9': -1, ':': 1, '=': 0, '>': 0, '': 0}
NONSTOCK_TYPES = ('2', '4', '5')   # บริการ / รายได้อื่น / ค่าใช้จ่ายอื่น ไม่กระทบสต๊อก
LINE = {}
rows, skipped = [], 0
seqcount = collections.Counter()
for r in dbf('STCRD'):
    dn = stcrd_doc(r)
    hid = H(dn)
    if not hid:
        skipped += 1; QUALITY['stcrd_header_missing'].append(dn); continue
    seqcount[hid] += 1
    ln = seqcount[hid]
    LINE[(dn, st(r['SEQNUM']), st(r['POSOPR']))] = lid = U('line', dn, st(r['SEQNUM']), st(r['POSOPR']), ln)
    mv = st(r['POSOPR']) or ''
    q = r['TRNQTY'] or 0
    eff = EFFECT.get(mv, 0)
    if mv == '8': eff = 1 if (r['XTRNQTY'] or 0) >= 0 else -1
    if ITYPE.get(st(r['STKCOD'])) in NONSTOCK_TYPES: eff = 0
    if dn.startswith('OB-'): eff = 1
    party = st(r['PEOPLE'])
    rows.append(base(id=lid, header_id=hid, line_no=ln, line_kind='I', item_id=item(r['STKCOD']) if st(r['STKCOD']) else None,
        description=r['STKDES'], warehouse_id=wh(r['LOCCOD']) if st(r['LOCCOD']) else None, department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
        qty=qty(q), unit_id=unit(r['TQUCOD']) if st(r['TQUCOD']) else None, factor=r['TFACTOR'] or 1, base_qty=qty(abs(r['XTRNQTY'] or 0)),
        unit_price=qty(r['UNITPR']), discount_text=st(r['DISC']), discount_amount=money(r['DISCAMT']), line_amount=money(r['TRNVAL']),
        net_amount=money(r['NETVAL']), vat_code=st(r['VATCOD']), is_free=r['FREE'] == 'Y', return_to_stock=(r['RETSTK'] == 'Y') if st(r['RETSTK']) else None,
        stock_effect=eff, movement_code=mv or None, cost_unit=qty(r['XUNITPR']), cost_amount=money(r['XTRNVAL']), sales_value=money(r['XSALVAL']),
        party_customer_id=CUS.get(party), party_supplier_id=SUP.get(party), salesperson_id=slm(r['SLMCOD']) if st(r['SLMCOD']) else None,
        gl_debit_account_id=acc(r['ACCNUMDR']) if st(r['ACCNUMDR']) else None, gl_credit_account_id=acc(r['ACCNUMCR']) if st(r['ACCNUMCR']) else None,
        reimburse_flag=st(r['REIMBURSE'])))
    if len(rows) >= 20000: done('doc_line', insert('doc_line', rows), 'STCRD'); rows = []
done('doc_line', insert('doc_line', rows), 'STCRD')
for table, num in (('OESOIT', 'SONUM'), ('POPRIT', 'PONUM')):
    rows = []
    for r in dbf(table):
        dn = st(r[num]); hid = H(dn)
        if not hid: QUALITY[f'{table}_header_missing'].append(dn); continue
        seqcount[hid] += 1
        rows.append(base(id=U('line', table, dn, st(r['SEQNUM'])), header_id=hid, line_no=seqcount[hid], item_id=item(r['STKCOD']), description=r['STKDES'],
            warehouse_id=wh(r['LOCCOD']) if st(r['LOCCOD']) else None, department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
            qty=qty(r['ORDQTY']), ordered_qty=qty(r['ORDQTY']), remaining_qty=qty(r['REMQTY']), cancelled_qty=qty(r['CANCELQTY']),
            cancel_reason_code=st(r['CANCELTYP']), cancel_date=r['CANCELDAT'], unit_id=unit(r['TQUCOD']), factor=r['TFACTOR'] or 1,
            base_qty=qty((r['ORDQTY'] or 0) * (r['TFACTOR'] or 1)), unit_price=qty(r['UNITPR']), discount_text=st(r['DISC']),
            discount_amount=money(r['DISCAMT']), line_amount=money(r['TRNVAL']), net_amount=money(r['TRNVAL']), is_free=r['FREE'] == 'Y',
            delivery_date=r.get('DLVDAT') or r.get('RCVDAT'), stock_effect=0))
    done('doc_line', insert('doc_line', rows), table)
rows = []
for r in dbf('GLPTTIT'):
    dn = st(r['DOCNUM']); hid = H(dn)
    if not hid: QUALITY['GLPTTIT_header_missing'].append(dn); continue
    seqcount[hid] += 1
    rows.append(base(id=U('line', 'PTT', dn, seqcount[hid]), header_id=hid, line_no=seqcount[hid], line_kind='G', account_id=acc(r['ACCNUM']),
                     description=r['DESCRP'], department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None, line_amount=money(r['AMOUNT']), net_amount=money(r['AMOUNT'])))
done('doc_line', insert('doc_line', rows), 'GLPTTIT')

# notes
rows, nseq, MDNOTES = [], collections.Counter(), []
for r in dbf('ARTRNRM'):
    dn = st(r['DOCNUM']); hid = H(dn)
    if not hid:
        owner = ('ITEM', ITEM.get(dn)) if dn in ITEM else ('SUPPLIER', SUP.get(dn)) if dn in SUP else ('CUSTOMER', CUS.get(dn)) if dn in CUS else (None, None)
        if owner[0]:
            nseq[owner] += 1
            MDNOTES.append(base(id=U('mdnote', owner[0], dn, nseq[owner]), entity_type=owner[0], entity_id=owner[1], seq=nseq[owner], text=(r['REMARK'] or '-')[:200]))
        else: QUALITY['ARTRNRM_owner_missing'].append(dn)
        continue
    s = r['SEQNUM'] or ''
    nseq[(hid, s)] += 1
    rows.append(base(id=U('note', dn, s, nseq[(hid, s)]), header_id=hid, line_id=None, seq=nseq[(hid, s)] + (0 if s.startswith('@') else 100 * int(re.sub(r'\D', '', s) or 0)),
                     text=(r['REMARK'] or '')[:200] or '-'))
done('doc_note', insert('doc_note', rows), 'ARTRNRM')
done('md_note', insert('md_note', MDNOTES), 'ARTRNRM (รหัสสินค้า/ผู้จำหน่าย)')

# settlement / payments
PENDING_SET = []
for table, module, amtf in (('ARRCPIT', 'AR', 'RCVAMT'), ('APRCPIT', 'AP', 'PAYAMT')):
    rows = []
    for r in dbf(table):
        p, i = H(r['RCPNUM'], module), H(r['DOCNUM'], module)
        pj = None
        if not p and i: PENDING_SET.append((table, r)); continue
        if not (p and i): QUALITY[f'{table}_missing_doc'].append(f"{st(r['RCPNUM'])}->{st(r['DOCNUM'])}"); continue
        rows.append(base(id=U('set', table, st(r['RCPNUM']), st(r['DOCNUM'])), payment_header_id=p, payment_journal_id=pj, invoice_header_id=i, express_rectype=r['RECTYP'],
                         amount=money(r[amtf]), vat_amount=money(r['VATAMT'])))
    done('doc_settlement', insert('doc_settlement', rows), table)

# cheques (BKTRN)
CHQ = {}
rows = []
for r in dbf('BKTRN'):
    t = st(r['BKTRNTYP']) or ''
    direction = 'R' if t in ('QR', 'bR', 'BU', 'BD', 'Bx') else 'P'
    inst = 'CHEQUE' if t in ('QR', 'QP') else 'TRANSFER'
    no = st(r['CHQNUM'])
    cid = U('chq', t, no, r['CHQDAT'])
    CHQ[no] = cid
    party = st(r['CUSCOD'])
    rows.append(base(id=cid, branch_id=BRANCH, direction=direction, instrument=inst, cheque_no=no or '-',
        cheque_date=r['CHQDAT'] or r['TRNDAT'], bank_id=BANK.get(st(r['BNKCOD'])), bank_branch=r['BRANCH'], bank_account_id=BKA.get(st(r['BNKACC'])),
        customer_id=CUS.get(party), supplier_id=SUP.get(party), payee_name=r['NAME'], department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
        received_date=r['GETDAT'], deposit_date=r['PAYINDAT'], pass_date=r['TRNDAT'], amount=money(r['AMOUNT']), charge=money(r['CHARGE']),
        net_amount=money(r['NETAMT']), remaining_amount=money(r['REMAMT']), status=st(r['CHQSTAT']) or '00', is_settled=r['CMPLAPP'] == 'Y',
        source_header_id=H(r['VOUCHER']), remark=r['REMARK']))
seen = set(); dedup = []
for x in rows:
    k = (x['direction'], x['cheque_no'])
    if k in seen: x['cheque_no'] = (x['cheque_no'] + '#' + x['id'][:4]); QUALITY['cheque_no_duplicate'].append(k[1])
    seen.add((x['direction'], x['cheque_no'])); dedup.append(x)
done('fin_cheque', insert('fin_cheque', dedup), 'BKTRN')

for table, module, amtf in (('ARRCPCQ', 'AR', 'RCVAMT'), ('APRCPCQ', 'AP', 'PAYAMT')):
    rows, ln = [], collections.Counter()
    d = 'R' if module == 'AR' else 'P'
    for r in dbf(table):
        hid = H(r['RCPNUM'], module) or H(r['RCPNUM'])
        if not hid: QUALITY[f'{table}_missing_doc'].append(st(r['RCPNUM'])); continue
        chq = st(r['CHQNUM']) or ''
        pm = PM.get((d, chq[:2])) or PM.get(('R' if d == 'P' else 'P', chq[:2]))
        if not pm: QUALITY[f'{table}_unknown_method'].append(chq[:2]); continue
        ln[hid] += 1
        rows.append(base(id=U('pay', table, st(r['RCPNUM']), chq, ln[hid]), header_id=hid, line_no=ln[hid], payment_method_id=pm,
                         reference_no=chq[2:] or None, amount=money(r[amtf]), cheque_id=CHQ.get(chq)))
    done('doc_payment', insert('doc_payment', rows), table)

# ------------------------------------------------------------------ GL
JRN = {}
rows = []
for r in dbf('GLJNL'):
    v = st(r['VOUCHER']); jb = JB.get(st(r['JNLTYP'])) or JB.get('00')
    jid = U('jnl', st(r['JNLTYP']), v); JRN[v] = jid
    rows.append(base(id=jid, branch_id=BRANCH, journal_book_id=jb, voucher_no=v, voucher_date=r['VOUDAT'], period_id=period_of(r['VOUDAT']),
                     description=r['DESCRP'], reference=st(r['REFNUM']), source_module=st(r['SRCJNL']), source_header_id=H(v),
                     status='P' if r['TRNSTAT'] == 'P' else 'U', doc_status='C' if r['DOCSTAT'] == 'C' else 'N',
                     print_count=int(r['PRNCNT'] or 0) if r['PRNCNT'] else 0))
done('gl_journal', insert('gl_journal', rows), 'GLJNL')
rows, lns, missing = [], collections.Counter(), 0
for r in dbf('GLJNLIT'):
    v = st(r['VOUCHER']); jid = JRN.get(v)
    if not jid: QUALITY['GLJNLIT_journal_missing'].append(v); continue
    lns[jid] += 1
    amt = money(r['AMOUNT'])
    dr = amt if r['TRNTYP'] == '0' else 0; cr = amt if r['TRNTYP'] == '1' else 0
    if amt < 0: dr, cr = (0, -amt) if r['TRNTYP'] == '0' else (-amt, 0)
    rows.append(base(id=U('jl', v, lns[jid]), journal_id=jid, line_no=lns[jid], account_id=acc(r['ACCNUM']),
                     department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None, description=r['DESCRP'], debit=dr, credit=cr,
                     changed_from_account_id=acc(r['CHGACCFROM']) if st(r['CHGACCFROM']) else None, resolved_from='M'))
    if len(rows) >= 20000: done('gl_journal_line', insert('gl_journal_line', rows), 'GLJNLIT'); rows = []
done('gl_journal_line', insert('gl_journal_line', rows), 'GLJNLIT')
cur.execute("UPDATE gl_journal j SET total_debit = s.d, total_credit = s.c FROM (SELECT journal_id, sum(debit) d, sum(credit) c FROM gl_journal_line GROUP BY 1) s WHERE s.journal_id = j.id")
cur.execute("UPDATE doc_header h SET journal_id = j.id FROM gl_journal j WHERE j.source_header_id = h.id")

# settlements whose payment side is a GL voucher (JV) — needs journals loaded first
rows = []
for table, r in PENDING_SET:
    module = 'AR' if table == 'ARRCPIT' else 'AP'; amtf = 'RCVAMT' if module == 'AR' else 'PAYAMT'
    pj = JRN.get(st(r['RCPNUM'])); i = H(r['DOCNUM'], module)
    if not pj: QUALITY[f'{table}_missing_doc'].append(f"{st(r['RCPNUM'])}->{st(r['DOCNUM'])}"); continue
    rows.append(base(id=U('set', table, st(r['RCPNUM']), st(r['DOCNUM'])), payment_header_id=None, payment_journal_id=pj, invoice_header_id=i,
                     express_rectype=r['RECTYP'], amount=money(r[amtf]), vat_amount=money(r['VATAMT'])))
done('doc_settlement', insert('doc_settlement', rows), 'ARRCPIT/APRCPIT (ตัดด้วยใบสำคัญ GL)')

# ------------------------------------------------------------------ AR/AP: ปรับให้ยอดคงค้างตรงกับ Express ณ วันย้ายระบบ
# บางใบ Express ตั้ง RCVAMT/PAYAMT = ชำระครบ แต่ไม่มีรายการตัดชำระใน ARRCPIT/APRCPIT → สร้างเอกสารปรับปรุงการย้ายข้อมูล 1 ใบต่อระบบ
for module, table, amtf in (('AR', 'ARTRN', 'RCVAMT'), ('AP', 'APTRN', 'PAYAMT')):
    cur.execute('SELECT invoice_header_id, sum(amount) FROM doc_settlement GROUP BY 1')
    settled = {k: float(v) for k, v in cur.fetchall()}
    adj = []
    for r in dbf(table):
        if r['RECTYP'] not in ('3', '4') or r['DOCSTAT'] == 'C': continue
        hid = H(r['DOCNUM'], module); diff = round((r[amtf] or 0) - settled.get(hid, 0), 2)
        if hid and abs(diff) >= 0.01: adj.append((hid, diff, st(r['DOCNUM'])))
    if adj:
        mdn = f'MIG-ADJ-{module}'
        last_day = max(p[1] for p in PERIODS if p[0].year <= (prd['END12NY'].year if prd and prd.get('END12NY') else 9999))
        hrow = hdr_row(mdn, 'RE' if module == 'AR' else 'PS', module, last_day,
                       remark='[ย้ายข้อมูล] ปรับยอดตัดชำระให้ตรงกับ Express (ชำระนอกใบเสร็จ/ใบสำคัญจ่าย)', net_amount=money(sum(a[1] for a in adj)))
        insert('doc_header', [hrow]); done('doc_header', 1, 'ปรับปรุงการย้ายข้อมูล')
        done('doc_settlement', insert('doc_settlement', [base(id=U('setadj', module, d), payment_header_id=hrow['id'], invoice_header_id=h, amount=a, vat_amount=0)
                                                           for h, a, d in adj]), f'{table}.{amtf} (ปรับปรุง)')
        QUALITY[f'{module}_settlement_adjusted'].extend(f'{d}:{a}' for h, a, d in adj)

# ------------------------------------------------------------------ GL ยอดยกมาต้นปีแรก จาก GLBAL (ยอดปีก่อน = BEGLY + ΣDEBITnLY − ΣCREDITnLY + ปิดบัญชี)
first = min(PERIODS, key=lambda p: p[0]) if PERIODS else None
cur.execute("SELECT start_date, id FROM gl_period WHERE company_id = %s ORDER BY start_date", (COMPANY,))
plist = cur.fetchall()
fy_first = None
if prd: fy_first = next((pid for b, pid in plist if b == prd['BEG1']), None)
rows, tot = [], 0.0
if fy_first:
    for r in dbf('GLBAL'):
        a = st(r['ACCNUM'])
        bal = (r['BEGLY'] or 0) + sum((r[f'DEBIT{m}LY'] or 0) - (r[f'CREDIT{m}LY'] or 0) for m in range(1, 13)) + (r['DEBITCLS'] or 0) - (r['CREDITCLS'] or 0)
        if abs(bal) < 0.005: continue
        tot += bal
        rows.append(base(id=U('glopen', a, st(r['DEPCOD'])), account_id=acc(a), department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
                         period_id=fy_first, opening=round(bal, 2), debit=0, credit=0))
    done('gl_balance', insert('gl_balance', rows), 'GLBAL (ยอดยกมาต้นปีแรก)')
    QUALITY['gl_opening_net_should_be_zero'].append(round(tot, 2))

# ------------------------------------------------------------------ tax
rows = []
for r in dbf('ISVAT'):
    vp = period_of(r['VATPRD']) or period_of(r['VATDAT']) or period_of(r['DOCDAT'])
    rows.append(base(id=U('vat', r['VATREC'], st(r['DOCNUM']), st(r['REFNUM']), r['VATDAT'], len(rows)), vat_kind=r['VATREC'] or 'P', header_id=H(r['DOCNUM']),
                     journal_id=JRN.get(st(r['DOCNUM'])), branch_id=BRANCH, doc_no=st(r['DOCNUM']) or '-', doc_date=r['DOCDAT'] or r['VATDAT'],
                     tax_invoice_no=st(r['REFNUM']), tax_invoice_date=r['VATDAT'] or r['DOCDAT'], vat_period_id=vp, is_late=r['LATE'] == 'Y',
                     department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None, description=r['DESCRP'], base_amount=money(r['AMT01']),
                     vat_amount=money(r['VAT01']), zero_rate_amount=money(r['AMTRAT0']), nonclaim_base=money(r['AMT02']), nonclaim_vat=money(r['VAT02']),
                     is_manual=r['SELF_ADDED'] == 'Y', is_modified=r['HAD_MODIFY'] == 'Y', doc_status='C' if r['DOCSTAT'] == 'C' else 'N', remark=r['REMARK']))
done('tax_vat_entry', insert('tax_vat_entry', rows), 'ISVAT')
rows = []
for r in dbf('ISTAX'):
    p = st(r['PEOPLE'])
    rows.append(base(id=U('wht', st(r['TAXTYP']), st(r['TAXNUM']), st(r['REFNUM']), len(rows)), form_type=st(r['TAXTYP']) or 'S03', header_id=H(r['REFNUM']),
                     branch_id=BRANCH, certificate_no=st(r['TAXNUM']), certificate_date=r['TAXDAT'], tax_period_id=period_of(r['TAXPRD']) or period_of(r['TAXDAT']),
                     is_late=r['LATE'] == 'Y', supplier_id=SUP.get(p), customer_id=CUS.get(p), payee_name=r['NAME'] or p or '-', payee_address=r['ADDR'],
                     payee_tax_id=(st(r['TAXID']) or '')[:13] or None, income_type=r['TAXDES'], paid_amount=money(r['AMOUNT']), rate=r['TAXRAT'] or 0,
                     tax_amount=money(r['TAXAMT']), condition=st(r['TAXCOND']), social_security_amount=r['SOCIALAMT'], provident_fund_amount=r['POVDNT'],
                     print_count=int(r['PRNCNT'] or 0) if r['PRNCNT'] else 0))
    if p and p not in SUP and p not in CUS: QUALITY['wht_party_missing'].append(p)
done('tax_wht_entry', insert('tax_wht_entry', rows), 'ISTAX')

# ------------------------------------------------------------------ fixed assets
rows, dep = [], []
for r in dbf('FAMAS'):
    c = st(r['FASCOD']); aid = U('fa', c)
    rows.append(base(id=aid, code=c, name_th=r['FASDES'] or c, name_en=r['FASDES2'], category_code=st(r['FASGRP']),
                     account_group_id=AAG.get(st(r['ACCCOD'])) or ref(AAG, 'md_asset_account_group', r['ACCCOD'], 'aag'),
                     is_depreciable=r['FASTYP'] != 'N', serial_no=st(r['SERIAL']), department_id=dept(r['DEPCOD']) if st(r['DEPCOD']) else None,
                     branch_id=BRANCH, purchase_date=r['PURDAT'], cost=money(r['COSVAL']), salvage_value=money(r['SALVAG']),
                     method=r['METHOD'] if r['METHOD'] in ('0','1','2') else '1', start_date=r['STRDAT'] or r['PURDAT'],
                     useful_life_years=int(r['LIFE']) if r['LIFE'] else None, rate=r['RATE'], end_date=r['ENDDAT'], depr_monthly=r['DPRMONLY'] != 'N',
                     accum_depr_bf=money(r['ACCMBF']), sold_date=r['SALDAT'], sold_amount=r['SALAMT'], status='S' if r['SALDAT'] else 'A'))
    for i, (suffix) in enumerate([str(m) for m in range(1, 13)] + [f'{m}NY' for m in range(1, 13)]):
        a = r.get(f'DEPR{suffix}')
        if a:
            b, e, pid = PERIODS[i] if i < len(PERIODS) else (None, None, None)
            if pid: dep.append(base(id=U('dep', c, pid), asset_id=aid, period_id=pid, amount=money(a)))
done('fa_asset', insert('fa_asset', rows), 'FAMAS'); done('fa_depreciation', insert('fa_depreciation', dep), 'FAMAS.DEPRn')

# ------------------------------------------------------------------ stock balance snapshot
rows = []
for r in dbf('STLOC'):
    if not st(r['STKCOD']): QUALITY['stloc_blank_item'].append('1'); continue
    rows.append(base(id=U('sb', st(r['STKCOD']), st(r['LOCCOD'])), item_id=item(r['STKCOD']), warehouse_id=wh(r['LOCCOD']),
                     qty_on_hand=qty(r['LOCBAL']), value_on_hand=money(r['LOCVAL']), avg_cost=nz(r['UNITPR']), qty_on_order=qty(r['LOCREO']),
                     qty_reserved=qty(r['LOCRES']), last_purchase_date=r['LPURDAT'], last_sale_date=r['LSELDAT'], last_move_date=r['LMOVDAT'],
                     last_count_date=r['TAKDAT'], shelf=st(r['AREA'])))
    if len(rows) >= 20000: done('inv_stock_balance', insert('inv_stock_balance', rows), 'STLOC'); rows = []
done('inv_stock_balance', insert('inv_stock_balance', rows), 'STLOC')

# ------------------------------------------------------------------ ค่าเริ่มต้นจาก ISINFO → sys_setting
YN = lambda v: (v or '').strip().upper() in ('Y', 'T', '1')
SETMAP = {'gen.link_gl': ('LINKGL', YN), 'gen.vat_rate': ('VATRAT', float), 'gen.price_type': ('FLGVAT', str), 'gen.year_system': ('YEARTHAI', lambda v: 'B' if v == '1' else 'C'),
          'gen.use_department': ('USEDEP', YN), 'gen.use_project': ('USEJOB', YN),
          'ic.posting_method': ('ISPERPETUA', lambda v: 'PERPETUAL' if YN(v) else 'PERIODIC'), 'ic.cost_method': ('COSMTD', lambda v: 'FIFO' if v == 'F' else 'AVERAGE'),
          'ic.cost_by_warehouse': ('LOC_COST', YN), 'ic.allow_negative': ('NEGALLOW', YN), 'ic.any_warehouse': ('ANYLOC', YN), 'ic.main_warehouse': ('MAINLOC', str),
          'ic.use_barcode': ('USEBARCOD', YN), 'ic.use_count_unit': ('USE_CQU', YN), 'ar.allow_over_credit': ('OVRCRALLOW', YN), 'ar.so_credit_lock': ('SO_CR_LOCK', YN),
          'fn.default_deposit_bank': ('BNKDEP', str), 'fn.default_paid_bank': ('BNKPAID', str), 'fn.auto_pass_cheque_paid': ('PASPCQAUTO', YN),
          'fn.wht_min_amount': ('MINTAXAMT', float), 'fn.wht_default_rate': ('MINTAXRAT', float), 'gl.account_mask': ('GLPICT', str), 'fa.asset_code_mask': ('FAPICT', str),
          'tax.input_vat_prorate': ('PVATPRORAT', YN)}
rows = []
for k, (f, fn) in SETMAP.items():
    v = info.get(f)
    if v is None: continue
    try: val = fn(st(v) if isinstance(v, str) else v)
    except Exception: continue
    rows.append(base(id=U('set', k), branch_id=None, module=k.split('.')[0].upper(), key=k, value=json.dumps(val, ensure_ascii=False)))
rows.append(base(id=U('set', 'ar.aging_overdue'), branch_id=None, module='AR', key='ar.aging_overdue', value=json.dumps([info.get('AROVR1'), info.get('AROVR2'), info.get('AROVR3')])))
rows.append(base(id=U('set', 'ap.aging_overdue'), branch_id=None, module='AP', key='ap.aging_overdue', value=json.dumps([info.get('APOVR1'), info.get('APOVR2'), info.get('APOVR3')])))
done('sys_setting', insert('sys_setting', rows), 'ISINFO')

# ------------------------------------------------------------------ แบบงบการเงิน (GLREP = หัวงบ/คอลัมน์, GLREPIT = บรรทัด) — Buddy Account
rows = []
for r in dbf('GLREP'):
    code = st(r['REPCOD'])
    if not code: continue
    cols = []
    for n in range(1, 19):
        expr = st(r.get(f'FLD{n}'))
        if not expr: continue
        cols.append({'expr': expr, 'head1': st(r.get(f'C{n}_HD1')) or '', 'head2': st(r.get(f'C{n}_HD2')) or '',
                     'department': st(r.get(f'DEP{n}')) or None, 'percent': st(r.get(f'PCENT{n}')) or None, 'print': st(r.get(f'PRINT{n}')) or None})
    heads = [st(r.get(f'HEAD_{n}')) or '' for n in range(1, 5)]
    rows.append(base(id=U('fsr', code), code=code[:10], name=st(r['REPNAM']) or code, header_lines=json.dumps(heads, ensure_ascii=False),
                     columns=json.dumps(cols, ensure_ascii=False), line_set_code=(st(r['LINCOD']) or code)[:10], number_format=st(r.get('PICT_1'))))
done('gl_fs_report', insert('gl_fs_report', rows), 'GLREP')
rows = []
for r in dbf('GLREPIT'):
    ls = st(r['REPCOD'])
    if not ls: continue
    try: ln = int(str(r['LINNUM']).strip())
    except (TypeError, ValueError): continue
    acc_ops = {x: (st(r.get('VAR_' + x)) or '') for x in 'ABCDE'}
    rows.append(base(id=U('fsl', ls, ln), line_set_code=ls[:10], line_no=ln, data_type=(st(r['DATTYP']) or 'TXT')[:4], source=st(r['SRCDAT']),
                     sign_filter=st(r['FILTER']) or None, description_th=st(r['DESCRP']), description_en=st(r['DESCRP2']),
                     print_condition=st(r['PRNCON']) or None, accumulate=json.dumps({k: v for k, v in acc_ops.items() if v}),
                     department_id=dept(r['DEPCOD']) if st(r.get('DEPCOD')) else None))
done('gl_fs_line', insert('gl_fs_line', rows), 'GLREPIT')

conn.commit()
summary = {'company': CO, 'counts': {k: v[0] for k, v in counts.items()}, 'sources': {k: v[1] for k, v in counts.items()},
           'quality': {k: {'count': len(v), 'examples': sorted(set(map(str, v)))[:15]} for k, v in QUALITY.items()}}
print(json.dumps(summary, ensure_ascii=False, indent=1))
