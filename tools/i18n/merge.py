"""
รวมคำแปลจาก tools/i18n/out/*.json (และ tools/i18n/extra.json ถ้ามี) → apps/web/src/i18n/en.json
ตรวจ: ช่องแทน {n} ครบตรงกัน, ค่าไม่ว่าง, ไม่มีอักษรไทยเหลือ — รายการที่ผิดไม่ใส่ในพจนานุกรม (คงภาษาไทย) และแจ้งไว้
ใช้: python tools/i18n/merge.py
"""
import glob, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TH = re.compile(r'[฀-๿]')
PH = re.compile(r'\{\d+\}')

def main():
    srcs = sorted(glob.glob(os.path.join(ROOT, 'tools/i18n/out/*.json')))
    extra = os.path.join(ROOT, 'tools/i18n/extra.json')
    if os.path.exists(extra): srcs.append(extra)            # แก้/เพิ่มคำแปลด้วยมือ (ทับชุดอัตโนมัติ)
    out, bad = {}, []
    for f in srcs:
        for th, en in json.load(open(f, encoding='utf-8')).items():
            if not isinstance(en, str) or not en.strip(): bad.append((th, en, 'ว่าง')); continue
            if sorted(PH.findall(th)) != sorted(PH.findall(en)): bad.append((th, en, 'ช่องแทนไม่ตรง')); continue
            if TH.search(en): bad.append((th, en, 'ยังมีภาษาไทย')); continue
            out[th] = en
    cat = json.load(open(os.path.join(ROOT, 'tools/i18n/catalog.json'), encoding='utf-8'))
    missing = [e['th'] for e in cat if e['th'] not in out]
    dst = os.path.join(ROOT, 'apps/web/src/i18n/en.json')
    json.dump(dict(sorted(out.items())), open(dst, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=0)
    print(f'en.json: {len(out)} คำแปล · แคตตาล็อก {len(cat)} · ยังไม่มีคำแปล {len(missing)} · ไม่ผ่านการตรวจ {len(bad)}')
    for th, en, why in bad[:30]: print(f'  ✗ {why}: {th[:60]} → {str(en)[:60]}')

if __name__ == '__main__':
    main()
