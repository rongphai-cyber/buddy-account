# -*- coding: utf-8 -*-
"""
สร้างแม่แบบผังบัญชีไทย–อังกฤษ จากไฟล์ตัวอย่างของเจ้าของ (docs/ChartOfAccount_with_English.xlsx, ชีต "ผังบัญชีครบ")
ใช้:  python tools/chart/xlsx_chart.py [--list]   → db/seed/chart_template_th_en.json
ไฟล์ xlsx เก็บไว้ในเครื่องเจ้าของ (ไม่อยู่ใน git) — ผลลัพธ์ JSON อยู่ใน git
คอลัมน์: A เลขบัญชี · B ชื่อไทย · C ชื่ออังกฤษ · D หมวด (ASSET/DEBT/EQUITY/REVENUE/EXPENSE) · E ระดับ 0–4 · F คุม/ย่อย
"""
import json, re, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'docs' / 'ChartOfAccount_with_English.xlsx'
OUT = ROOT / 'db' / 'seed' / 'chart_template_th_en.json'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
GROUP = {'ASSET': '1', 'DEBT': '2', 'EQUITY': '3', 'REVENUE': '4', 'EXPENSE': '5'}

def rows(path):
    z = zipfile.ZipFile(path)
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    for r in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).find('m:sheetData', NS):
        out = {}
        for c in r:
            v = c.find('m:v', NS)
            out[re.sub(r'\d', '', c.get('r'))] = '' if v is None else (ss[int(v.text)] if c.get('t') == 's' else v.text)
        yield out

# บทบาทบัญชีสำหรับลงบัญชีอัตโนมัติ (gl_default_account) — เลขในผังตัวอย่างนี้
ROLES = {
  'CASH': '1111-01', 'PETTY_CASH': '1111-02', 'AR': '1130-01', 'CHEQUE_RECEIVED': '1130-02', 'INVENTORY': '1140-02',
  'INPUT_VAT': '1154-00', 'INPUT_VAT_PENDING': '1155-00', 'PREPAID_TAX': '1158-00', 'DEPOSIT_PAID': '1151-01',
  'AP': '2120-01', 'CHEQUE_PAID': '2120-02', 'WHT_PAYABLE': '2132-03', 'VAT_PAYABLE': '2137-00', 'VAT_REFUND': '1156-00', 'OUTPUT_VAT': '2135-00', 'OUTPUT_VAT_PENDING': '2136-00', 'DEPOSIT_RECEIVED': '2133-01',
  'RETAINED_EARNINGS': '3200-00',
  'CASH_SALES': '4100-01', 'CREDIT_SALES': '4100-01', 'SALES_RETURN': '4100-03', 'SALES_DISCOUNT': '4100-04',
  'INTEREST_INCOME': '4200-01', 'BANK_INCOME': '4200-01', 'OTHER_INCOME': '4200-09',
  'COGS': '5110-00', 'PURCHASES': '5130-01', 'PURCHASE_DISCOUNT': '5130-02', 'PURCHASE_RETURN': '5130-03',
  'BANK_CHARGE': '5460-04', 'INTEREST_EXPENSE': '5470-03', 'BAD_DEBT': '5480-00', 'OTHER_EXPENSE': '5470-08',
  'INPUT_VAT_NONCLAIM': '5490-02', 'INPUT_VAT_UNCLAIMABLE': '5490-04',
  'SUSPENSE': '9999-99',
}

def build():
    accs = []
    for r in rows(SRC):
        no, th, en, cat, lev = (r.get(k, '').strip() for k in 'ABCDE')
        if not re.fullmatch(r'\d{4}-\d{2}', no) or cat not in GROUP or not lev.isdigit(): continue
        accs.append({'no': no, 'th': th, 'en': en or None, 'level': int(lev) + 1, 'group': GROUP[cat], 'flag': r.get('F', '').strip()})
    # บัญชีคุม = บรรทัดก่อนหน้าที่ระดับต่ำกว่า (ตามลำดับในผัง)
    stack = []
    for a in accs:
        while stack and stack[-1]['level'] >= a['level']: stack.pop()
        a['parent'] = stack[-1]['no'] if stack else None
        stack.append(a)
    parents = {a['parent'] for a in accs if a['parent']}
    for a in accs:
        a['control'] = a['no'] in parents or a['flag'] == 'คุม'
        a['side'] = 'D' if a['group'] in ('1', '5') else 'C'
        a['dept'] = False
        del a['flag']
    # ระดับต้องต่อเนื่องจากบัญชีคุม (ผังบางบรรทัดข้ามระดับ)
    by = {a['no']: a for a in accs}
    for a in accs:
        if a['parent']: a['level'] = by[a['parent']]['level'] + 1
        else: a['level'] = 1
    # บัญชีที่มีลูกเป็นบัญชีคุมเสมอ แต่ "คุม" ที่ไม่มีลูกให้เป็นบัญชีย่อย (ลงรายการได้)
    for a in accs:
        if a['control'] and a['no'] not in parents: a['control'] = False
    dup = [n for n in by if sum(1 for a in accs if a['no'] == n) > 1]
    if dup: sys.exit(f'เลขบัญชีซ้ำ: {dup}')
    roles = {k: v for k, v in ROLES.items() if v in by and not by[v]['control']}
    missing = sorted(set(ROLES) - set(roles))
    return accs, roles, missing

if __name__ == '__main__':
    accs, roles, missing = build()
    if '--list' in sys.argv:
        for a in accs: print(a['no'], a['level'], 'C' if a['control'] else ' ', a['th'], '|', a['en'])
        print('roles missing:', missing); sys.exit()
    express = json.loads((ROOT / 'db/seed/chart_template_express.json').read_text(encoding='utf-8'))
    out = {'source': 'docs/ChartOfAccount_with_English.xlsx (ผังบัญชีตัวอย่างไทย–อังกฤษของเจ้าของ)', 'accounts': accs, 'default_roles': roles, 'journal_books': express['journal_books']}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(f'{OUT.name}: {len(accs)} บัญชี, บทบาท {len(roles)}/{len(ROLES)}', 'ไม่พบ:' if missing else '', ' '.join(missing))
