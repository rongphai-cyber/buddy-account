"""
ดึงข้อความภาษาไทยทั้งหมดที่แสดงบนหน้าจอ/ข้อความแจ้ง ออกมาเป็นแคตตาล็อกสำหรับแปล (สลับ 2 ภาษา — ข้อกำหนดเจ้าของข้อ 9)
  - '...' / "..."           → ข้อความตรงตัว
  - `...${x}...`            → แบบมีช่องแทน {0} {1}
  - ข้อความใน JSX >...{x}...< → แบบมีช่องแทน
ใช้: python tools/i18n/extract.py  → tools/i18n/catalog.json  (th, files) เรียงตามจำนวนที่ใช้
ไม่นับคอมเมนต์ แฟ้มทดสอบ และข้อความที่ไม่มีอักษรไทย
"""
import json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIRS = ['apps/web/src', 'apps/server/src', 'packages/core/src']
TH = re.compile(r'[฀-๿]')

def strip_comments(s: str) -> str:
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c in '\'"`':                      # ข้ามสตริง (เก็บไว้)
            j = i + 1
            while j < n and s[j] != c:
                if s[j] == '\\': j += 1
                if c == '`' and s[j:j + 2] == '${':
                    depth, j = 1, j + 2
                    while j < n and depth:
                        if s[j] == '{': depth += 1
                        elif s[j] == '}': depth -= 1
                        j += 1
                    continue
                j += 1
            out.append(s[i:j + 1]); i = j + 1; continue
        if s.startswith('//', i) and (i == 0 or s[i - 1] != ':'):
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if s.startswith('/*', i):
            j = s.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if s.startswith('{/*', i):
            j = s.find('*/}', i); i = n if j < 0 else j + 3; continue
        out.append(c); i += 1
    return ''.join(out)

def norm(t: str) -> str:
    return re.sub(r'\s+', ' ', t).strip()

def template_to_pattern(body: str) -> str:
    """`a ${x} b ${y}` → 'a {0} b {1}'"""
    out, k, i = [], 0, 0
    while i < len(body):
        if body.startswith('${', i):
            depth, j = 1, i + 2
            while j < len(body) and depth:
                if body[j] == '{': depth += 1
                elif body[j] == '}': depth -= 1
                j += 1
            out.append('{%d}' % k); k += 1; i = j; continue
        out.append(body[i]); i += 1
    return ''.join(out)

STR = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")
JSX_TEXT = re.compile(r'>([^<>]*[฀-๿][^<>]*)<')

def jsx_segment_to_pattern(seg: str) -> str:
    out, k, i = [], 0, 0
    while i < len(seg):
        if seg[i] == '{':
            depth, j = 1, i + 1
            while j < len(seg) and depth:
                if seg[j] == '{': depth += 1
                elif seg[j] == '}': depth -= 1
                j += 1
            inner = seg[i + 1:j - 1].strip()
            m = re.fullmatch(r"'([^']*)'|\"([^\"]*)\"", inner)
            if m: out.append(m.group(1) or m.group(2) or '')      # {' '} ในข้อความ
            else: out.append('{%d}' % k); k += 1
            i = j; continue
        out.append(seg[i]); i += 1
    return ''.join(out)

def extract(path: str):
    s = strip_comments(open(path, encoding='utf-8').read())
    found = []
    # template literal
    i = 0
    while True:
        a = s.find('`', i)
        if a < 0: break
        j, depth = a + 1, 0
        while j < len(s):
            if s[j] == '\\': j += 2; continue
            if s.startswith('${', j): depth += 1; j += 2; continue
            if depth and s[j] == '}': depth -= 1; j += 1; continue
            if not depth and s[j] == '`': break
            j += 1
        body = s[a + 1:j]
        if TH.search(body):
            if 'sql`' not in s[max(0, a - 4):a + 1]: found.append(norm(template_to_pattern(body)))
        i = j + 1
    for m in STR.finditer(s):
        t = m.group(1) if m.group(1) is not None else m.group(2)
        if t and TH.search(t): found.append(norm(t.replace("\\'", "'").replace('\\"', '"').replace('\\n', ' ')))
    if path.endswith('.tsx'):
        for m in JSX_TEXT.finditer(s):
            seg = m.group(1)
            if '=>' in seg or ';' in seg and 'return' in seg: continue
            p = norm(jsx_segment_to_pattern(seg))
            if TH.search(p): found.append(p)
    return [f for f in found if TH.search(f) and len(f) < 600]

def main():
    cat = {}
    for d in DIRS:
        for root, _, fs in os.walk(os.path.join(ROOT, d)):
            for f in fs:
                if not f.endswith(('.ts', '.tsx')) or '.test.' in f: continue
                p = os.path.join(root, f)
                rel = os.path.relpath(p, ROOT).replace('\\', '/')
                for t in extract(p):
                    e = cat.setdefault(t, {'th': t, 'n': 0, 'files': []})
                    e['n'] += 1
                    if rel not in e['files']: e['files'].append(rel)
    rows = sorted(cat.values(), key=lambda e: (-e['n'], e['th']))
    out = os.path.join(ROOT, 'tools/i18n/catalog.json')
    json.dump(rows, open(out, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=0)
    pats = sum(1 for r in rows if re.search(r'\{\d+\}', r['th']))
    print(f'catalog: {len(rows)} ข้อความ (แบบมีช่องแทน {pats}) ~{sum(len(r["th"]) for r in rows):,} ตัวอักษร')

if __name__ == '__main__':
    main()
