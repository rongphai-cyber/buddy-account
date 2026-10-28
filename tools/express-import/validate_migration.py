# -*- coding: utf-8 -*-
"""กระทบยอดหลังย้ายข้อมูล: ฐานข้อมูลใหม่ vs แฟ้ม Express ต้นทาง  ใช้: python3 validate_migration.py <โฟลเดอร์ Express> <PG DSN>"""
import os,sys,collections,json,psycopg2,datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import express_dbf
from express_dbf import header,records
D = express_dbf.D = sys.argv[1]
def it(t):
    h=header(os.path.join(D,t+'.DBF')); return records(os.path.join(D,t+'.DBF'),h)
pg=psycopg2.connect(sys.argv[2]); c=pg.cursor()
def q(s): c.execute(s); return c.fetchall()
R={}
# 1 GL balanced
R['journals_total']=q("select count(*) from gl_journal")[0][0]
R['journals_unbalanced']=q("select count(*) from gl_journal where total_debit<>total_credit and doc_status='N'")[0][0]
R['unbalanced_examples']=q("select voucher_no,total_debit,total_credit from gl_journal where total_debit<>total_credit and doc_status='N' order by abs(total_debit-total_credit) desc limit 5")
tb=q("select sum(debit),sum(credit) from gl_journal_line l join gl_journal j on j.id=l.journal_id where j.doc_status='N'")[0]
R['trial_balance_debit_credit']=[float(tb[0]),float(tb[1])]
# 2 GL opening (from GLBAL) + journals must stay balanced
ob=q("select coalesce(sum(opening),0), count(*) from gl_balance")[0]
R['gl_opening_rows']=ob[1]; R['gl_opening_net']=float(ob[0])
R['gl_closing_balanced']=q("""select round(sum(x),2) from (select sum(opening) x from gl_balance union all
   select sum(l.debit-l.credit) from gl_journal_line l join gl_journal j on j.id=l.journal_id where j.doc_status='N') t""")[0][0]
# 3 stock: STLOC.LOCBAL vs sum(base_qty*effect) per item/wh
loc={}
for r in it('STLOC'):
    if r['STKCOD'].strip(): loc[(r['STKCOD'].strip(),r['LOCCOD'].strip())]=r['LOCBAL'] or 0
led={(i,w):float(qv) for i,w,qv in q("select i.code,w.code,sum(l.base_qty*l.stock_effect) from doc_line l join doc_header h on h.id=l.header_id join md_item i on i.id=l.item_id join md_warehouse w on w.id=l.warehouse_id where l.stock_effect<>0 group by 1,2")}
typ={r['STKCOD'].strip():r['STKTYP'] for r in it('STMAS')}
keys=set(k for k,v in loc.items() if abs(v)>1e-6 and typ.get(k[0]) not in ('2','4','5'))|set(k for k,v in led.items() if abs(v)>1e-6)
sm=sum(1 for k in keys if abs(loc.get(k,0)-led.get(k,0))<0.001)
R['stock_pairs_compared']=len(keys); R['stock_pairs_match']=sm
R['stock_diff_examples']=sorted(((round(loc.get(k,0),4),round(led.get(k,0),4),k) for k in keys if abs(loc.get(k,0)-led.get(k,0))>=0.001),key=lambda x:-abs(x[0]-x[1]))[:6]
# 4 AR outstanding vs ARTRN.REMAMT for IV (not cancelled)
ex={r['DOCNUM'].strip():(r['NETAMT'] or 0,r['RCVAMT'] or 0,r['REMAMT'] or 0) for r in it('ARTRN') if r['RECTYP']=='3' and r['DOCSTAT']!='C'}
mine={d:(float(a),float(s),float(o)) for d,a,s,o in q("select doc_no,amount,settled,outstanding from v_ar_outstanding where doc_class='IV'")}
R['ar_docs']=len(ex); R['ar_settled_match_before_adj']='see migrate'; R['ar_settled_match']=sum(1 for d,(n,rc,rm) in ex.items() if d in mine and abs(mine[d][1]-rc)<0.01)
R['ar_outstanding_total_express_REMAMT']=round(sum(v[2] for v in ex.values()),2)
R['ar_outstanding_total_express_NET_minus_RCV']=round(sum(v[0]-v[1] for v in ex.values()),2)
R['ar_outstanding_total_new']=round(sum(v[2] for v in mine.values()),2)
exap={r['DOCNUM'].strip():(r['NETAMT'] or 0,r['PAYAMT'] or 0) for r in it('APTRN') if r['RECTYP'] in ('3',) and r['DOCSTAT']!='C'}
R['ap_outstanding_total_express']=round(sum(a-b for a,b in exap.values()),2)
R['ap_outstanding_total_new']=float(q("select coalesce(sum(outstanding),0) from v_ap_outstanding where doc_class='RR'")[0][0])
# 5 row parity
par={'STCRD':('doc_line',"select count(*) from doc_line l join doc_header h on h.id=l.header_id where l.line_kind='I' and l.ordered_qty is null"),
     'GLJNLIT':('gl_journal_line',"select count(*) from gl_journal_line"),'ISVAT':('tax_vat_entry',"select count(*) from tax_vat_entry"),
     'STMAS':('md_item',"select count(*) from md_item where name_th not like '[MISSING]%'"),'ARTRN':('doc_header',"select count(*) from doc_header where module='AR' and doc_class<>'BS'"),
     'APTRN':('doc_header',"select count(*) from doc_header where module='AP' and doc_class<>'BR' and remark is distinct from '[สร้างจากบรรทัดรายการ — Express ไม่มีหัวเอกสาร]'")}
src={k:sum(1 for _ in it(k)) for k in par}
R['row_parity']={k:(src[k],q(s)[0][0]) for k,(t,s) in par.items()}
print(json.dumps(R,ensure_ascii=False,indent=1,default=str))
