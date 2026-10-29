# -*- coding: utf-8 -*-
"""สร้าง docs/04_ความครอบคลุมหน้าจอ.md จากผลวิเคราะห์คู่มือ Express (docs/express/data/*.json)
สถานะการพัฒนาแต่ละหน้าจออยู่ใน docs/coverage_status.json  (key = "chNN:รหัสหน้าจอ")
ใช้:  python3 docs/tools/gen_coverage.py
"""
import json, glob, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)
DATA = os.path.join(DOCS, 'express', 'data')
STATUS_FILE = os.path.join(DOCS, 'coverage_status.json')

# บท → (เฟส, โมดูลใน Buddy Account)
CHAPTER_PLAN = {
    'ch03': ('P0', 'ui'),        'ch04': ('P0', 'company'),  'ch05': ('P2', 'settings'),
    'ch06': ('P1', 'gl'),        'ch07': ('P2', 'master'),   'ch08': ('P1', 'opening'),
    'ch09': ('P2', 'doctype'),   'ch10': ('P2', 'posting'),  'ch11': ('P3', 'purchase'),
    'ch12': ('P3', 'sales'),     'ch13': ('P4', 'bank'),     'ch14': ('P4', 'inventory'),
    'ch15': ('P1', 'gl'),        'ch16': ('P3', 'tax'),      'ch17': ('P5', 'report'),
    'ch18': ('P1', 'gl'),        'ch19': ('P6', 'asset'),    'ch20': ('P6', 'admin'),
    'ch21': ('P6', 'admin'),     'ch22': ('P6', 'gl'),       'ch23': ('P0', 'security'),
    'ch24': ('P1', 'fs'),        'ch25': ('P5', 'report'),   'ch26': ('P7', 'business'),
    'ch27': ('P7', 'print'),     'chAP': ('P0', 'ui'),
}
# รายหน้าจอที่อยู่คนละเฟสกับบทของมัน
OVERRIDE = {
    'ch07:S-GL-01': ('P1', 'gl'), 'ch07:S-GL-02': ('P1', 'gl'), 'ch07:R-GL-01': ('P1', 'gl'),
    'ch06:S-SET-03': ('P1', 'master'),
    'ch08:S-OB-01': ('P4', 'opening'), 'ch08:S-OB-02': ('P4', 'opening'),
    'ch08:S-OB-03': ('P3', 'opening'), 'ch08:S-OB-04': ('P3', 'opening'), 'ch08:S-OB-05': ('P4', 'opening'),
    'ch15:S-GL-03': ('P3', 'tax'), 'ch15:S-GL-04': ('P4', 'bank'),
    'ch15:S-GL-11': ('P3', 'gl'), 'ch15:S-GL-12': ('P3', 'gl'), 'ch15:S-GL-13': ('P3', 'gl'),
    'ch15:S-GL-14': ('P4', 'gl'), 'ch15:S-GL-15': ('P4', 'gl'),
    'ch23:S-SEC-04': ('P6', 'security'), 'ch23:S-SEC-04a': ('P6', 'security'),
    'ch23:S-SEC-06': ('P6', 'security'), 'ch23:S-SEC-07': ('P6', 'security'), 'ch23:S-SEC-08': ('P6', 'security'),
    'ch16:S-TX-09': ('P3', 'tax'), 'ch16:S-TX-10': ('P3', 'tax'), 'ch16:S-TX-11': ('P5', 'tax'),
    'ch04:S-CO-04': ('P6', 'company'), 'ch04:S-CO-05': ('P6', 'company'), 'ch04:S-CO-06': ('P6', 'company'),
}
PHASES = {
    'P0': 'ฐานระบบ: หน้าจอหลัก ผู้ใช้ บริษัท',
    'P1': 'บัญชีแยกประเภท งบการเงิน ยอดยกมา GL',
    'P2': 'ค่าเริ่มต้น แฟ้มหลัก เลขที่เอกสาร การเชื่อมบัญชี',
    'P3': 'ซื้อ/เจ้าหนี้ ขาย/ลูกหนี้ ภาษีซื้อ-ขาย หัก ณ ที่จ่าย',
    'P4': 'ธนาคาร/เช็ค สินค้าคงคลังและต้นทุน',
    'P5': 'รายงาน แบบฟอร์ม และแบบยื่นภาษี',
    'P6': 'ทรัพย์สิน สิ้นปี สำรองข้อมูล ตรวจสอบ สิทธิ์ขั้นสูง',
    'P7': 'ธุรกิจเฉพาะ การพิมพ์ ติดตั้งในเครื่อง ออฟไลน์ API AI',
}
STATUS_TH = {'todo': 'รอทำ', 'wip': 'กำลังทำ', 'done': 'เสร็จ', 'replaced': 'ทำแบบใหม่แทน', 'na': 'ไม่ต้องทำบนเว็บ'}

def main():
    status = json.load(open(STATUS_FILE, encoding='utf-8')) if os.path.exists(STATUS_FILE) else {}
    rows = []
    for f in sorted(glob.glob(os.path.join(DATA, '*.json'))):
        ch = os.path.basename(f)[:-5]
        d = json.load(open(f, encoding='utf-8'))
        for s in d['screens']:
            key = f"{ch}:{s['id']}"
            ph, mod = OVERRIDE.get(key, CHAPTER_PLAN[ch])
            st = status.get(key, {})
            rows.append(dict(key=key, ch=ch, title=d['title'], id=s['id'], name=s['name'], menu=s.get('menu', ''),
                             page=s.get('book_page'), nf=len(s.get('fields', [])), phase=ph, module=mod,
                             status=st.get('status', 'todo'), where=st.get('where', ''), note=st.get('note', '')))
    # สร้างไฟล์สถานะเริ่มต้นถ้ายังไม่มีหน้าจอนั้น
    changed = False
    for r in rows:
        if r['key'] not in status:
            status[r['key']] = {'status': 'todo'}; changed = True
    if changed:
        json.dump(status, open(STATUS_FILE, 'w', encoding='utf-8', newline=''), ensure_ascii=False, indent=1, sort_keys=True)

    L = ['# ความครอบคลุมหน้าจอเทียบคู่มือ Express', '',
         '> สร้างอัตโนมัติด้วย `python3 docs/tools/gen_coverage.py` จากผลวิเคราะห์คู่มือ (`docs/express/data`) และสถานะใน `docs/coverage_status.json`',
         '> เป้าหมายขั้นต่ำของ Buddy Account: **ทุกหน้าจอในคู่มือต้องมีหน้าที่เทียบเท่า** (สถานะ เสร็จ / ทำแบบใหม่แทน / ไม่ต้องทำบนเว็บ พร้อมเหตุผล)', '']
    L += ['## สรุปตามเฟส', '', '| เฟส | ขอบเขต | หน้าจอ | ช่องข้อมูล | เสร็จ | กำลังทำ | รอทำ | อื่น ๆ |', '|---|---|---|---|---|---|---|---|']
    for ph, th in PHASES.items():
        rs = [r for r in rows if r['phase'] == ph]
        c = collections.Counter(r['status'] for r in rs)
        L.append(f"| {ph} | {th} | {len(rs)} | {sum(r['nf'] for r in rs)} | {c['done']} | {c['wip']} | {c['todo']} | {c['replaced'] + c['na']} |")
    c = collections.Counter(r['status'] for r in rows)
    L.append(f"| **รวม** | | **{len(rows)}** | **{sum(r['nf'] for r in rows)}** | **{c['done']}** | **{c['wip']}** | **{c['todo']}** | **{c['replaced'] + c['na']}** |")
    L.append('')
    for ph, th in PHASES.items():
        rs = [r for r in rows if r['phase'] == ph]
        L += [f'## {ph} — {th}', '', '| หน้าจอ | ชื่อ | เมนู Express | หน้า | ช่อง | โมดูล | สถานะ | อยู่ที่ / หมายเหตุ |', '|---|---|---|---|---|---|---|---|']
        for r in rs:
            where = ' · '.join(x for x in [r['where'], r['note']] if x)
            menu = r['menu'].replace('|', '/')[:70]
            L.append(f"| `{r['key']}` | {r['name']} | {menu} | {r['page'] or ''} | {r['nf']} | {r['module']} | {STATUS_TH.get(r['status'], r['status'])} | {where} |")
        L.append('')
    open(os.path.join(DOCS, '04_ความครอบคลุมหน้าจอ.md'), 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')
    print('screens', len(rows), dict(c))

if __name__ == '__main__':
    main()
