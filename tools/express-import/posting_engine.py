# -*- coding: utf-8 -*-
"""
เครื่องลงบัญชีอัตโนมัติ (ต้นแบบ) — สร้างรายการ Dr/Cr จากเอกสาร ตามกฎใน gl_posting_rule และลำดับการหาบัญชี 3 ชั้น (คู่มือบทที่ 10)
  ชั้น 1  บัญชีที่ประเภทเอกสาร (md_doc_type_account)
  ชั้น 2  บัญชีในแฟ้มหลัก (ลูกค้า/ผู้จำหน่าย/กลุ่มบัญชีสินค้า/วิธีชำระเงิน/บัญชีเงินฝาก)
  ชั้น 3  บัญชีมาตรฐาน (gl_default_account)
  หาไม่ได้ → บัญชีพัก (SUSPENSE)
ใช้:  python3 posting_engine.py <DSN> [--compare]   (--compare = เทียบกับใบสำคัญที่ Express ลงไว้)
"""
import sys, collections, psycopg2
from decimal import Decimal as Dm

DSN = sys.argv[1]; COMPARE = '--compare' in sys.argv
pg = psycopg2.connect(DSN); q = pg.cursor()
def rows(sql, *a): q.execute(sql, a); return q.fetchall()

DEF = dict(rows("select d.role, d.account_id from gl_default_account d"))
SETTING_PERPETUAL = False   # ISINFO.ISPERPETUA = 'N' สำหรับข้อมูลชุดนี้ — ระบบจริงอ่านจาก sys_setting 'ic.posting_method'
CUS = {i: a for i, a in rows("select id, ar_account_id from md_customer")}
SUP = {i: a for i, a in rows("select id, ap_account_id from md_supplier")}
ITEM = {i: (t, g) for i, t, g in rows("select id, item_type, account_group_id from md_item")}
IAG = {i: dict(inv=a, cogs=b, sales=c, sret=d, pur=e, pret=f) for i, a, b, c, d, e, f in rows(
    "select id, inventory_account_id, cogs_account_id, sales_account_id, sales_return_account_id, purchase_account_id, purchase_return_account_id from md_item_account_group")}
PM = {i: a for i, a in rows("select id, gl_account_id from md_payment_method")}
CHQ_ACC = {i: a for i, a in rows("select c.id, b.gl_account_id from fin_cheque c join md_bank_account b on b.id = c.bank_account_id")}
# ความหมายของช่องบัญชีที่ประเภทเอกสาร (ISRUN.ACCNUM01–12) แตกต่างตามหมวดเอกสาร — ยืนยันจากใบสำคัญจริง
SLOT_ROLE = {
  'RR': {3: 'AP'}, 'CP': {3: 'AP'}, 'DN': {3: 'AP'},
  'HP': {3: 'ROUNDING', 4: 'CASH'},                 # PP: 3 = ส่วนขาดเกินการชำระ, 4 = เจ้าหนี้เงินสดย่อย
  'RE': {3: 'ROUNDING', 6: 'ROUNDING'}, 'PS': {2: 'ROUNDING', 5: 'ROUNDING'},
  'AE': {1: 'DEPOSIT_PAID', 3: 'CASH'}, 'AI': {3: 'DEPOSIT_RECEIVED'},
  'HS': {5: 'SALES'}, 'OU': {1: 'ISSUE_DEBIT', 2: 'ISSUE_CREDIT'}, 'JU': {1: 'ADJ_DEBIT', 2: 'ADJ_CREDIT'},
  'CA': {2: 'COST_ADJ'}, 'BD': {2: 'CASH'}, 'BW': {1: 'CASH'}, 'QP': {1: 'CASH'}, 'BU': {2: 'BANK_INCOME'}, 'BV': {1: 'BANK_EXPENSE'}, 'BQ': {2: 'BANK_CHARGE'},
}
def slot_acct(dt, cls, role):
    for k, r in SLOT_ROLE.get(cls, {}).items():
        if r == role and DTA[dt].get(k): return DTA[dt][k]
    return None
DTA = collections.defaultdict(dict)
for dt, slot, a in rows("select doc_type_id, slot, account_id from md_doc_type_account"): DTA[dt][slot] = a

def pick(*cands):
    """คืน (account, layer) จากตัวเลือกตามลำดับชั้น"""
    for layer, a in cands:
        if a: return a, layer
    return DEF.get('SUSPENSE'), 'S'

def line_account(kind, item_id, doc_type_id, h_class):
    t, g = ITEM.get(item_id, (None, None))
    grp = IAG.get(g, {})
    if kind == 'SALES':
        return pick(('1', slot_acct(doc_type_id, h_class, 'SALES')), ('2', grp.get('sales')), ('3', DEF.get('CASH_SALES' if h_class == 'HS' else 'CREDIT_SALES')))
    if kind == 'SALES_RETURN':
        return pick(('2', grp.get('sret')), ('3', DEF.get('SALES_RETURN')))
    if kind == 'PURCHASE':
        if t in ('5', '2'):   # รหัสค่าใช้จ่ายอื่น/บริการ → บัญชีค่าใช้จ่ายในกลุ่ม (ACCNUM01)
            return pick(('2', grp.get('inv')), ('3', DEF.get('OTHER_EXPENSE')))
        if SETTING_PERPETUAL:
            return pick(('2', grp.get('inv')), ('3', DEF.get('INVENTORY')))
        return pick(('2', grp.get('pur')), ('3', DEF.get('PURCHASES')))
    if kind == 'PURCHASE_RETURN':
        if t in ('5', '2'): return pick(('2', grp.get('inv')), ('3', DEF.get('OTHER_EXPENSE')))
        return pick(('2', grp.get('pret')), ('3', DEF.get('PURCHASE_RETURN')))
    raise ValueError(kind)

def post(h):
    """h = dict ของหัวเอกสาร → list ของ (account_id, debit, credit, role, layer)"""
    out = []
    def D(acct, amt, role):
        a, layer = acct
        if amt: out.append((a, Dm(amt) if amt > 0 else Dm(0), Dm(0) if amt > 0 else -Dm(amt), role, layer))
    def C(acct, amt, role): D(acct, -amt, role)
    cls = h['doc_class']; dt = h['doc_type_id']
    lines = LINES.get(h['id'], [])
    vat_role = lambda base: (base + '_PENDING') if h['vat_basis'] == '2' else base
    party_ar = pick(('2', CUS.get(h['customer_id'])), ('3', DEF.get('AR')))
    party_ap = pick(('1', slot_acct(dt, cls, 'AP')), ('2', SUP.get(h['supplier_id'])), ('3', DEF.get('AP')))
    def pay_acct(p):
        return pick(('2', PM.get(p['method'])), ('2', CHQ_ACC.get(p['cheque'])), ('3', DEF.get('CHEQUE_RECEIVED' if cls in ('RE', 'AI', 'OI', 'HS') else 'CHEQUE_PAID')))
    cash = pick(('3', DEF.get('CASH')))
    gross = sum((l['net_amount'] for l in lines), Dm(0)) + h['vat_amount']
    deposit_used = (gross - h['net_amount']) if h['deposit_amount'] else Dm(0)   # ยอดมัดจำที่หักจริง = (รายการ + VAT) − ยอดสุทธิ
    pays_total = sum((p['amount'] for p in PAYS.get(h['id'], [])), Dm(0))
    cash_rest = lambda total: (total - pays_total) if total - pays_total >= Dm('0.01') else Dm(0)   # ส่วนที่เหลือ = เงินสด (Express เก็บที่หัวเอกสาร)
    if cls in ('IV', 'DR', 'HS'):
        D(party_ar if cls != 'HS' else pick(('3', DEF.get('CASH'))), h['net_amount'], 'AR')
        for l in lines: C(line_account('SALES', l['item_id'], dt, cls), l['net_amount'], 'SALES')
        C(pick(('3', DEF.get(vat_role('OUTPUT_VAT')))), h['vat_amount'], 'OUTPUT_VAT')
        if deposit_used:
            D(pick(('3', DEF.get('DEPOSIT_RECEIVED'))), deposit_used, 'DEPOSIT_RECEIVED')
    elif cls == 'CN':
        C(party_ar, h['net_amount'], 'AR')
        for l in lines: D(line_account('SALES_RETURN', l['item_id'], dt, cls), l['net_amount'], 'SALES_RETURN')
        D(pick(('3', DEF.get(vat_role('OUTPUT_VAT')))), h['vat_amount'], 'OUTPUT_VAT')
    elif cls in ('RR', 'CP', 'HP'):
        for l in lines: D(line_account('PURCHASE', l['item_id'], dt, cls), l['net_amount'], 'PURCHASE')
        D(pick(('3', DEF.get(vat_role('INPUT_VAT')))), h['vat_amount'], 'INPUT_VAT')
        if cls == 'HP':
            C(pick(('1', slot_acct(dt, cls, 'CASH')), ('3', DEF.get('CASH'))), cash_rest(h['net_amount']), 'CASH')
            for p in PAYS.get(h['id'], []): C(pay_acct(p), p['amount'], 'PAYMENT')
        else: C(party_ap, h['net_amount'], 'AP')
        if deposit_used and cls == 'RR':
            C(pick(('3', DEF.get('DEPOSIT_PAID'))), deposit_used, 'DEPOSIT_PAID')
    elif cls == 'DN':
        D(party_ap, h['net_amount'], 'AP')
        for l in lines: C(line_account('PURCHASE_RETURN', l['item_id'], dt, cls), l['net_amount'], 'PURCHASE_RETURN')
        C(pick(('3', DEF.get(vat_role('INPUT_VAT')))), h['vat_amount'], 'INPUT_VAT')
    elif cls in ('RE', 'PS'):
        for s in SETT.get(h['id'], []):
            if s['rectype'] == '0': continue          # ตัดเงินมัดจำ: ลงผ่านวิธีชำระ "หักมัดจำ" ไม่กระทบลูกหนี้/เจ้าหนี้
            sign = -1 if s['rectype'] == '5' else 1    # ใบลดหนี้ที่นำมาหักในใบเสร็จ/ใบสำคัญจ่าย
            party = pick(('2', (CUS if cls == 'RE' else SUP).get(s['party'])), ('3', DEF.get('AR' if cls == 'RE' else 'AP')))
            (C if cls == 'RE' else D)(party, sign * s['amount'], 'AR' if cls == 'RE' else 'AP')
            if s['vat']:   # ภาษีเกณฑ์เงินสด: โอนจากรอเรียกเก็บ/ยังไม่ถึงกำหนด เป็นภาษีจริง (ใบลดหนี้เป็นยอดลบ)
                v = sign * s['vat']
                if cls == 'RE': D(pick(('3', DEF.get('OUTPUT_VAT_PENDING'))), v, 'OUTPUT_VAT_PENDING'); C(pick(('3', DEF.get('OUTPUT_VAT'))), v, 'OUTPUT_VAT')
                else: D(pick(('3', DEF.get('INPUT_VAT'))), v, 'INPUT_VAT'); C(pick(('3', DEF.get('INPUT_VAT_PENDING'))), v, 'INPUT_VAT_PENDING')
        party_total = sum(((-1 if x['rectype'] == '5' else 1) * x['amount'] for x in SETT.get(h['id'], []) if x['rectype'] != '0'), Dm(0))
        (D if cls == 'RE' else C)(cash, cash_rest(party_total), 'CASH')
        for p in PAYS.get(h['id'], []):
            (D if cls == 'RE' else C)(pay_acct(p), p['amount'], 'PAYMENT')
    elif cls in ('AI', 'AE', 'OE', 'OI'):
        if cls in ('AI', 'OI'):
            D(cash, cash_rest(h['net_amount']), 'CASH')
            for p in PAYS.get(h['id'], []): D(pay_acct(p), p['amount'], 'PAYMENT')
            if cls == 'AI': C(pick(('1', slot_acct(dt, cls, 'DEPOSIT_RECEIVED')), ('3', DEF.get('DEPOSIT_RECEIVED'))), h['net_amount'] - h['vat_amount'], 'DEPOSIT_RECEIVED')
            else:
                for l in lines: C(line_account('SALES', l['item_id'], dt, cls), l['net_amount'], 'OTHER_INCOME')
            C(pick(('3', DEF.get('OUTPUT_VAT'))), h['vat_amount'], 'OUTPUT_VAT')
        else:
            if cls == 'AE': D(pick(('1', slot_acct(dt, cls, 'DEPOSIT_PAID')), ('3', DEF.get('DEPOSIT_PAID'))), h['net_amount'] - h['vat_amount'], 'DEPOSIT_PAID')
            else:
                for l in lines: D(line_account('PURCHASE', l['item_id'], dt, cls), l['net_amount'], 'EXPENSE')
            D(pick(('3', DEF.get('INPUT_VAT'))), h['vat_amount'], 'INPUT_VAT')
            C(pick(('1', slot_acct(dt, cls, 'CASH')), ('3', DEF.get('CASH'))), cash_rest(h['net_amount']), 'CASH')
            for p in PAYS.get(h['id'], []): C(pay_acct(p), p['amount'], 'PAYMENT')
    return out

H = rows("""select id, doc_class, doc_type_id, customer_id, supplier_id, net_amount, vat_amount, taxable_amount, deposit_amount, vat_basis, doc_no, cash_amount
            from doc_header where doc_status <> 'C' and doc_class in ('IV','DR','HS','CN','RR','CP','HP','DN','RE','PS','AI','AE','OE','OI')""")
cols = ['id', 'doc_class', 'doc_type_id', 'customer_id', 'supplier_id', 'net_amount', 'vat_amount', 'taxable_amount', 'deposit_amount', 'vat_basis', 'doc_no', 'cash_amount']
H = [dict(zip(cols, r)) for r in H]
LINES = collections.defaultdict(list)
for hid, item, amt in rows("select header_id, item_id, net_amount from doc_line where line_kind='I' and item_id is not null and net_amount <> 0"):
    LINES[hid].append({'item_id': item, 'net_amount': amt})
SETT = collections.defaultdict(list)
for pid, amt, vat, cus, sup, rt in rows("""select s.payment_header_id, s.amount, s.vat_amount, i.customer_id, i.supplier_id, s.express_rectype
     from doc_settlement s join doc_header i on i.id = s.invoice_header_id where s.payment_header_id is not null"""):
    SETT[pid].append({'amount': amt, 'vat': vat, 'party': cus or sup, 'rectype': rt})
PAYS = collections.defaultdict(list)
for hid, m, amt, chq in rows("select header_id, payment_method_id, amount, cheque_id from doc_payment"): PAYS[hid].append({'method': m, 'amount': amt, 'cheque': chq})

if COMPARE:
    EXP = collections.defaultdict(lambda: collections.defaultdict(Dm))
    for hid, acc, net in rows("""select j.source_header_id, l.account_id, sum(l.debit - l.credit) from gl_journal j join gl_journal_line l on l.journal_id = j.id
                                  where j.doc_status = 'N' and j.source_header_id is not null group by 1,2"""):
        EXP[hid][acc] += net
    res = collections.defaultdict(lambda: [0, 0, 0])
    layers = collections.Counter(); examples = collections.defaultdict(list)
    for h in H:
        if h['id'] not in EXP: continue
        mine = collections.defaultdict(Dm)
        for a, d, c, role, layer in post(h):
            mine[a] += d - c; layers[layer] += 1
        e = {k: v for k, v in EXP[h['id']].items() if v != 0}; m = {k: v for k, v in mine.items() if v != 0}
        r = res[h['doc_class']]; r[0] += 1
        if all(abs(e.get(k, 0) - m.get(k, 0)) < Dm('0.02') for k in set(e) | set(m)): r[1] += 1
        elif abs(sum(abs(v) for v in e.values()) - sum(abs(v) for v in m.values())) < Dm('0.05'): r[2] += 1   # ยอดรวมตรงแต่บัญชีต่าง
        elif len(examples[h['doc_class']]) < 3: examples[h['doc_class']].append(h['doc_no'])
    print('class  vouchers  exact_match  same_total_diff_account')
    tot = [0, 0, 0]
    for k, (n, ok, tot_ok) in sorted(res.items(), key=lambda x: -x[1][0]):
        print(f'{k:5s} {n:9d} {ok:9d} ({100*ok/n:5.1f}%) {tot_ok:7d}   e.g. {examples[k]}')
        tot = [tot[0] + n, tot[1] + ok, tot[2] + tot_ok]
    print(f'TOTAL {tot[0]} exact {tot[1]} ({100*tot[1]/tot[0]:.1f}%) same-total {tot[2]}')
    print('account resolved by layer:', dict(layers))
