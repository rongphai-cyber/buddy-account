# -*- coding: utf-8 -*-
"""
เทียบตัวเลขรายงานหลักของ Buddy Account กับแฟ้ม Express ต้นทาง (T5.9 · เกณฑ์ P5 ใน docs/03_แผนพัฒนา.md)
ใช้: BASE=http://127.0.0.1:4100 USER=admin PASS=... python compare_reports.py <โฟลเดอร์ Express> <รหัสบริษัทใน Buddy> [ไฟล์ผล.json] [--years N --last-year Y]
  --years/--last-year: บริษัทตัวอย่าง DEMO (tools/demo-data/make_demo.py) เลื่อนวันที่ +N ปี และย้ายเอกสารที่พิมพ์ปีผิด (หลังปี Y) มาปี Y
  เช่น DEMO จาก TESTRice: --years 16 --last-year 2010
อ่านอย่างเดียว: เรียกเฉพาะ API รายงาน (POST /api/v1/rpt/:code/run) ไม่เขียนข้อมูล

ตัวเลขที่เทียบ (Express คำนวณจาก .DBF โดยตรง ไม่ผ่านฐานข้อมูลใหม่)
  1 ลูกหนี้คงค้าง (1.A.1)  = ARTRN.REMAMT ของ IV/DR − CN ที่ไม่ยกเลิก
  2 เจ้าหนี้คงค้าง (2.A.1) = APTRN.REMAMT ของ RR/CP − DN ที่ไม่ยกเลิก
  3 สินค้าคงเหลือ (4.2.1)  = STLOC.LOCBAL / LOCVAL
  4 ทะเบียนเอกสารรายปี (1.x.1 / 2.x.1) = จำนวนใบ + NETAMT ของ ARTRN/APTRN ตาม RECTYP
  5 ภาษีมูลค่าเพิ่มรายเดือน (6.1) = ISVAT AMT01/VAT01 (ขาย S / ซื้อ P) + AMTRAT0 ตามงวดภาษี (ยื่นปกติ+เพิ่มเติม) · ใบลดหนี้ RECTYP 5 หักออก
"""
import os, sys, json, collections, http.cookiejar, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import express_dbf
from express_dbf import header, records
from decimal import Decimal as Dm

opt = lambda k, dflt: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else dflt
YEARS, LAST = int(opt('--years', '0')), int(opt('--last-year', '9999'))
pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and not sys.argv[i - 1].startswith('--')]
D, CO = pos[0], pos[1]
OUT = pos[2] if len(pos) > 2 else None
BASE = os.environ.get('BASE', 'http://127.0.0.1:4100')
express_dbf.D = D
def it(t):
    p = os.path.join(D, t + '.DBF'); return list(records(p, header(p)))
def m(v): return Dm(str(round(v or 0.0, 2))).quantize(Dm('0.01'))
def q3(v): return Dm(str(round(v or 0.0, 3))).quantize(Dm('0.001'))
def iso(s):
    """วันที่ Express (YYYYMMDD) → วันที่ในบริษัทที่เทียบ (เลื่อนปีแบบ make_demo ถ้ากำหนด)"""
    if not s or len(s) != 8: return None
    y = int(s[:4])
    return f'{min(y, LAST) + YEARS:04d}-{s[4:6]}-{s[6:8]}'

# ---------------------------------------------------------------- Buddy API
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def api(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST', headers={'content-type': 'application/json'})
    with op.open(req, timeout=300) as r: return json.loads(r.read().decode('utf-8'))
api('/api/v1/auth/login', {'username': os.environ.get('USER', 'admin'), 'password': os.environ['PASS']})
me = api('/api/v1/auth/me')
co = next((c for c in me['companies'] if c['code'] == CO), None)
if not co: sys.exit(f'ไม่พบบริษัท {CO} ที่ผู้ใช้นี้เข้าได้')
api('/api/v1/auth/select', {'company_id': co['id']})
def run(code, params):
    x = api(f'/api/v1/rpt/{code}/run', {'params': params})
    if 'error' in x: raise RuntimeError(f"{code}: {x['error']['message']}")
    return x
def total(x): return next((r['c'] for r in reversed(x['rows']) if r.get('t') == 'total'), {})

rows, ok_all = [], True
def check(topic, express, buddy, note=''):
    global ok_all
    ok = express == buddy
    ok_all &= ok
    rows.append({'topic': topic, 'express': str(express), 'buddy': str(buddy), 'diff': str(Dm(str(buddy)) - Dm(str(express))) if not ok else '0', 'ok': ok, 'note': note})

FAR = '2099-12-31'
# 1–2 ลูกหนี้/เจ้าหนี้คงค้าง
ar = it('ARTRN'); ap = it('APTRN')
def outstanding(rs, pos, neg):
    s = Dm('0')
    for r in rs:
        if r['DOCSTAT'] == 'C': continue
        if r['RECTYP'] in pos: s += m(r['REMAMT'])
        elif r['RECTYP'] in neg: s -= m(r['REMAMT'])
    return s
check('ลูกหนี้คงค้างทั้งหมด (1.A.1)', outstanding(ar, ('3', '4'), ('5',)), Dm(total(run('1.A.1', {'as_of': FAR})).get('out', '0')))
check('เจ้าหนี้คงค้างทั้งหมด (2.A.1)', outstanding(ap, ('3', '4'), ('5',)), Dm(total(run('2.A.1', {'as_of': FAR})).get('out', '0')))
# 3 สินค้าคงเหลือ
st = list(it('STLOC'))
t421 = total(run('4.2.1', {'as_of': FAR}))
check('สินค้าคงเหลือ จำนวน (4.2.1)', sum((q3(r['LOCBAL']) for r in st), Dm('0')), Dm(t421.get('qty', '0')).quantize(Dm('0.001')))
check('สินค้าคงเหลือ มูลค่า (4.2.1)', sum((m(r['LOCVAL']) for r in st), Dm('0')), Dm(t421.get('value', '0')))
# 4 ทะเบียนเอกสารรายปี
GROUPS = [('AR', ar, '0', '1.1', 'รับเงินมัดจำ'), ('AR', ar, '1', '1.2', 'ขายเงินสด'), ('AR', ar, '3', '1.4', 'ขายเงินเชื่อ'), ('AR', ar, '7', '1.5', 'รายได้อื่น'),
          ('AR', ar, '4', '1.7', 'ใบเพิ่มหนี้'), ('AR', ar, '5', '1.8', 'ใบลดหนี้'), ('AP', ap, '0', '2.1', 'จ่ายเงินมัดจำ'), ('AP', ap, '1', '2.2', 'ซื้อเงินสด'),
          ('AP', ap, '3', '2.4', 'ซื้อเงินเชื่อ'), ('AP', ap, '7', '2.5', 'ค่าใช้จ่ายอื่น'), ('AP', ap, '4', '2.7', 'ใบเพิ่มหนี้ (เจ้าหนี้)'), ('AP', ap, '5', '2.8', 'ใบลดหนี้/ส่งคืน')]
years = sorted({iso(r['DOCDAT'])[:4] for r in ar + ap if iso(r['DOCDAT'])})
for side, rs, rt, grp, label in GROUPS:
    by = collections.defaultdict(lambda: [0, Dm('0')])
    for r in rs:
        if r['RECTYP'] != rt or r['DOCSTAT'] == 'C' or not iso(r['DOCDAT']): continue
        y = iso(r['DOCDAT'])[:4]; by[y][0] += 1; by[y][1] += m(r['NETAMT'])
    for y in years:
        if y not in by: continue
        t = total(run(f'{grp}.1', {'date_from': f'{y}-01-01', 'date_to': f'{y}-12-31'}))
        n = int(''.join(ch for ch in str(t.get('party', '')) if ch.isdigit()) or 0)
        net = abs(Dm(t.get('net', '0')))
        check(f'{grp} {label} ปี {y} จำนวนใบ', by[y][0], n)
        check(f'{grp} {label} ปี {y} ยอดสุทธิ', by[y][1], net)
# 5 ภาษีมูลค่าเพิ่มรายเดือน (ตามงวดภาษี)
vat = collections.defaultdict(lambda: {'S': [Dm('0'), Dm('0'), Dm('0')], 'P': [Dm('0'), Dm('0')]})
for r in it('ISVAT'):
    if r['DOCSTAT'] == 'C': continue
    d = iso(r['VATPRD']) or iso(r['VATDAT']) or iso(r['DOCDAT'])
    if not d: continue
    k = d[:7]; kind = r['VATREC'] or 'P'
    sg = -1 if r['RECTYP'] == '5' else 1   # ใบลดหนี้ (RECTYP 5) เก็บยอดบวกในแฟ้มภาษี — รายงานภาษีของ Express หักออก
    if kind == 'S': v = vat[k]['S']; v[0] += sg * m(r['AMT01']); v[1] += sg * m(r['VAT01']); v[2] += sg * m(r['AMTRAT0'])
    else: v = vat[k]['P']; v[0] += sg * m(r['AMT01']); v[1] += sg * m(r['VAT01'])
for k in sorted(vat):
    x = run('6.1', {'period': k, 'filing': 'all'})['rows']
    def pick(label, col):
        r = next((r for r in x if r['c'].get('item') == label), None)
        return Dm(r['c'].get(col) or '0') if r else Dm('0')
    e = vat[k]
    check(f'ภาษีขาย {k} ภาษี (6.1)', e['S'][1], pick('มูลค่าขายที่ต้องเสียภาษี', 'vat'))
    check(f'ภาษีขาย {k} มูลค่า (6.1)', e['S'][0], pick('มูลค่าขายที่ต้องเสียภาษี', 'base'))
    check(f'ขายอัตราศูนย์ {k} (6.1)', e['S'][2], pick('มูลค่าขายอัตราศูนย์', 'base'))
    check(f'ภาษีซื้อ {k} ภาษี (6.1)', e['P'][1], pick('ขอคืนได้', 'vat'))
    check(f'ภาษีซื้อ {k} มูลค่า (6.1)', e['P'][0], pick('ขอคืนได้', 'base'))

bad = [r for r in rows if not r['ok']]
for r in rows:
    if not r['ok'] or os.environ.get('VERBOSE'): print(('✓ ' if r['ok'] else '✗ ') + r['topic'], 'Express', r['express'], 'Buddy', r['buddy'], ('ต่าง ' + r['diff']) if not r['ok'] else '')
print(f'ตรง {len(rows) - len(bad)}/{len(rows)} รายการ')
if OUT: json.dump({'company': CO, 'express_dir': D, 'checked': len(rows), 'mismatch': len(bad), 'rows': rows}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
sys.exit(0 if ok_all else 1)
