# -*- coding: utf-8 -*-
"""ตัวอ่านแฟ้ม FoxPro .DBF ของ Express (ไม่ต้องติดตั้งไลบรารีเพิ่ม) + ตัวดึง index expression จาก .CDX"""
import struct, os, json, sys, re, collections
D=None  # ตั้งค่าโดยผู้เรียก
def header(path):
    f=open(path,'rb'); h=f.read(32)
    ver=h[0]; y,m,d=h[1:4]; n=struct.unpack('<I',h[4:8])[0]; hl,rl=struct.unpack('<HH',h[8:12]); cp=h[29]
    fields=[]; off=1
    while True:
        b=f.read(32)
        if not b or b[0]==0x0D: break
        name=b[:11].split(b'\0')[0].decode('ascii','replace'); t=chr(b[11]); ln=b[16]; dec=b[17]; flags=b[18]
        fields.append(dict(name=name,type=t,len=ln,dec=dec,flags=flags,off=off)); off+=ln
    return dict(ver=ver,date=f'{1900+y if y>80 else 2000+y}-{m:02d}-{d:02d}',records=n,hlen=hl,rlen=rl,codepage=cp,fields=fields)
def records(path, h, limit=None):
    f=open(path,'rb'); f.seek(h['hlen'])
    for i in range(h['records'] if limit is None else min(limit,h['records'])):
        r=f.read(h['rlen'])
        if len(r)<h['rlen']: break
        if r[0:1]==b'*': continue
        out={}
        for fd in h['fields']:
            raw=r[fd['off']:fd['off']+fd['len']]
            t=fd['type']
            if t in 'CM':
                v=raw.decode('cp874','replace').rstrip()
            elif t in 'NF':
                s=raw.decode('ascii','replace').strip(); 
                try: v=float(s) if s else None
                except: v=s
            elif t=='D':
                s=raw.decode('ascii','replace').strip(); v=s or None
            elif t=='L':
                v=raw.decode('ascii','replace')
            elif t=='I': v=struct.unpack('<i',raw)[0]
            elif t=='B': v=struct.unpack('<d',raw)[0]
            elif t=='Y': v=struct.unpack('<q',raw)[0]/10000
            elif t=='T':
                jd,ms=struct.unpack('<ii',raw); v=(jd,ms)
            else: v=raw.hex()
            out[fd['name']]=v
        yield out
def cdx_tags(path):
    # crude: extract printable key expressions from CDX
    b=open(path,'rb').read()
    exprs=set(re.findall(rb'[A-Z][A-Z0-9_\(\)\+\,\.\" \'\-]{4,120}',b))
    return sorted(e.decode() for e in exprs)
