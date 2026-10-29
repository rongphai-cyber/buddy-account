# -*- coding: utf-8 -*-
import os, re, json, csv, sys
sys.path.insert(0, os.path.dirname(__file__))
from spec import TABLES, MODULES, C, T

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'db', 'generated')
os.makedirs(OUT, exist_ok=True); os.makedirs(os.path.join(ROOT, 'docs', 'db'), exist_ok=True)
TBL = {t.name: t for t in TABLES}

def pg_type(t):
    m = re.match(r'(code|str|char)(\d+)$', t)
    if m:
        k, n = m.groups()
        return f'char({n})' if k == 'char' else f'varchar({n})'
    return {'uuid':'uuid','text':'text','money':'numeric(18,2)','qty':'numeric(18,4)','rate':'numeric(9,4)',
            'int':'integer','smallint':'smallint','bigint':'bigint','bool':'boolean','date':'date',
            'ts':'timestamptz','json':'jsonb','bigserial':'bigserial'}[t]

def lite_type(t):
    if t in ('int','smallint','bigint','bool'): return 'INTEGER'
    if t == 'bigserial': return 'INTEGER'
    return 'TEXT'   # uuid, varchar, decimals as exact decimal strings, dates ISO-8601, json

def common_cols(t: T):
    cols = []
    if t.common:
        cols.append(C('id', 'uuid', nn=True, th='รหัสแถว UUIDv7 (สร้างได้ทั้งบนเซิร์ฟเวอร์และเครื่องลูกโดยไม่ชนกัน)'))
        if t.company:
            cols.append(C('company_id', 'uuid', nn=True, fk='sys_company', th='บริษัท'))
    return cols

def audit_cols(t: T):
    if not t.common: return []
    return [
        C('created_at', 'ts', nn=True, d='now()', th='เวลาสร้าง'),
        C('created_by', 'uuid', fk='sys_user', th='ผู้สร้าง', src='CREBY'),
        C('updated_at', 'ts', nn=True, d='now()', th='เวลาแก้ไขล่าสุด', src='CHGDAT'),
        C('updated_by', 'uuid', fk='sys_user', th='ผู้แก้ไขล่าสุด', src='USERID'),
        C('row_version', 'bigint', nn=True, d='1', th='เวอร์ชันของแถว (เพิ่มทุกครั้งที่แก้ ใช้ตรวจ conflict)'),
        C('deleted_at', 'ts', th='ลบแบบ soft delete (Express ใช้เครื่องหมาย * ลบ)'),
        C('origin_device_id', 'uuid', th='เครื่องที่สร้างแถวนี้'),
    ]

def all_cols(t):
    return common_cols(t) + t.cols + audit_cols(t)

def pk_of(t):
    if t.common: return 'id'
    first = t.cols[0]
    return first.name

def ident(n):  # quote reserved words
    return f'"{n}"' if n in ('key','value','condition','text','level','status','role','columns','source','seq','op','kind','code','name') and False else n

# ---------------------------------------------------------------- PostgreSQL
def gen_pg():
    L = []
    L.append('-- =====================================================================')
    L.append('-- Buddy Account — โครงสร้างฐานข้อมูล (ออกแบบตามโครงสร้างโปรแกรม Express)')
    L.append('-- สร้างอัตโนมัติจาก spec.py  — อย่าแก้ไฟล์นี้ด้วยมือ ให้แก้ spec แล้วสร้างใหม่')
    L.append('-- =====================================================================')
    L.append('-- ต้องใช้ PostgreSQL 13+ (gen_random_uuid มีในตัว) — ใช้ได้ทั้ง PostgreSQL และ PGlite')
    L.append('')
    fks = []
    for t in TABLES:
        cols = all_cols(t)
        L.append(f'-- {t.name}: {t.th}' + (f'  [Express: {t.express}]' if t.express else ''))
        L.append(f'CREATE TABLE {t.name} (')
        defs = []
        for c in cols:
            s = f'  {c.name} {pg_type(c.type)}'
            if c.name == 'id' and t.common: s += ' DEFAULT gen_random_uuid()'
            elif c.d is not None: s += f' DEFAULT {c.d}'
            if c.nn: s += ' NOT NULL'
            if c.chk: s += f' CHECK ({c.chk})'
            defs.append(s)
            if c.fk and c.fk in TBL:
                fks.append((t.name, c.name, c.fk))
        defs.append(f'  PRIMARY KEY ({pk_of(t)})')
        if t.name == 'gl_journal_line':
            defs.append('  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))')
        if t.name == 'doc_settlement':
            defs.append('  CHECK ((payment_header_id IS NULL) <> (payment_journal_id IS NULL))')
        if t.name == 'md_doc_number_block':
            defs.append('  CHECK (range_start <= next_no AND next_no <= range_end + 1)')
        L.append(',\n'.join(defs))
        L.append(');')
        L.append(f"COMMENT ON TABLE {t.name} IS {pg_str(t.th + (' | Express: ' + t.express if t.express else '') + (' | ' + t.note if t.note else ''))};")
        for c in cols:
            if c.th or c.src:
                L.append(f"COMMENT ON COLUMN {t.name}.{c.name} IS {pg_str(c.th + (' [Express: ' + c.src + ']' if c.src else ''))};")
        for u in t.uniq:
            nm = f'uq_{t.name}_' + '_'.join(x.replace('_id','') for x in u)
            where = ' WHERE deleted_at IS NULL' if t.common else ''
            cols_u = ', '.join(u)
            # treat NULL branch/line as a value for uniqueness
            NULLABLE = ('tenant_id','branch_id','line_id','department_id','customer_id','payment_header_id','payment_journal_id','bank_account_id')
            if any(x in NULLABLE for x in u):
                cols_u = ', '.join(f"COALESCE({x}, '00000000-0000-0000-0000-000000000000'::uuid)" if x in NULLABLE else x for x in u)
            L.append(f'CREATE UNIQUE INDEX {nm[:60]} ON {t.name} ({cols_u}){where};')
        for i in t.idx:
            nm = f'ix_{t.name}_' + '_'.join(x.replace('_id','') for x in i)
            L.append(f'CREATE INDEX {nm[:60]} ON {t.name} ({", ".join(i)});')
        L.append('')
    L.append('-- ---------------------------------------------------------------- Foreign keys')
    L.append('-- DEFERRABLE INITIALLY DEFERRED: ให้รับข้อมูลซิงก์หลายตารางในทรานแซกชันเดียวโดยไม่ต้องเรียงลำดับ')
    for (tb, col, ref) in fks:
        nm = f'fk_{tb}_{col}'
        if len(nm) > 60:
            import hashlib; nm = nm[:50] + '_' + hashlib.md5(nm.encode()).hexdigest()[:8]
        L.append(f'ALTER TABLE {tb} ADD CONSTRAINT {nm} FOREIGN KEY ({col}) REFERENCES {ref}(id) DEFERRABLE INITIALLY DEFERRED;')
        import hashlib
        ixn = f'ix_fk_{tb}_{col}'
        if len(ixn) > 60: ixn = ixn[:50] + '_' + hashlib.md5(ixn.encode()).hexdigest()[:8]
        L.append(f'CREATE INDEX IF NOT EXISTS {ixn} ON {tb} ({col});')
    L.append('')
    L.append(PG_FUNCS)
    synced = [t.name for t in TABLES if t.common and t.sync in ('both',)]
    server_only_common = [t.name for t in TABLES if t.common and t.sync == 'server']
    L.append('-- ---------------------------------------------------------------- Attach triggers')
    for n in synced + server_only_common:
        L.append(f'CREATE TRIGGER trg_{n}_ver BEFORE UPDATE ON {n} FOR EACH ROW EXECUTE FUNCTION sys_bump_version();')
    for n in synced:
        L.append(f'CREATE TRIGGER trg_{n}_log AFTER INSERT OR UPDATE ON {n} FOR EACH ROW EXECUTE FUNCTION sync_log_change();')
    L.append('CREATE CONSTRAINT TRIGGER trg_gl_journal_balanced AFTER INSERT OR UPDATE ON gl_journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_check_balanced();')
    L.append('CREATE TRIGGER trg_gl_journal_period BEFORE INSERT OR UPDATE ON gl_journal FOR EACH ROW EXECUTE FUNCTION gl_check_period_open();')
    L.append('CREATE TRIGGER trg_doc_header_period BEFORE INSERT OR UPDATE ON doc_header FOR EACH ROW EXECUTE FUNCTION gl_check_period_open();')
    L.append('CREATE TRIGGER trg_activity_log_ro BEFORE UPDATE OR DELETE ON sys_activity_log FOR EACH ROW EXECUTE FUNCTION sys_append_only();')
    L.append('')
    L.append(PG_VIEWS)
    open(os.path.join(OUT, 'schema.sql'), 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')
    return synced

def pg_str(s):
    return "'" + s.replace("'", "''") + "'"

PG_FUNCS = r"""
-- ---------------------------------------------------------------- Functions
-- เพิ่ม row_version และ updated_at ทุกครั้งที่แก้ไข
CREATE OR REPLACE FUNCTION sys_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

-- บันทึกการเปลี่ยนแปลงลง sync_change_log ให้เครื่องลูกดึงไป
CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_company uuid; v_branch uuid; j jsonb;
BEGIN
  j := to_jsonb(NEW);
  v_company := COALESCE((j->>'company_id')::uuid, CASE WHEN TG_TABLE_NAME='sys_company' THEN NEW.id END);
  v_branch  := (j->>'branch_id')::uuid;
  IF v_company IS NULL THEN RETURN NEW; END IF;   -- ตารางระดับระบบ (ผู้ใช้/เมนู) ส่งทุกบริษัทผ่าน endpoint แยก
  INSERT INTO sync_change_log(company_id, branch_id, table_name, row_id, op, row_version, origin_device_id)
  VALUES (v_company, v_branch, TG_TABLE_NAME, NEW.id,
          CASE WHEN NEW.deleted_at IS NOT NULL THEN 'D' ELSE 'U' END,
          NEW.row_version, NULLIF(current_setting('app.device_id', true), '')::uuid);
  RETURN NEW;
END $$;

-- ห้ามแก้/ลบ log (กรมสรรพากรกำหนดให้เก็บ ≥ 2 ปี)
CREATE OR REPLACE FUNCTION sys_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'sys_activity_log is append-only'; END $$;

-- ใบสำคัญที่ผ่านรายการ (status = P) ต้องเดบิต = เครดิต
CREATE OR REPLACE FUNCTION gl_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  IF NEW.status = 'P' AND NEW.doc_status = 'N' THEN
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c
      FROM gl_journal_line WHERE journal_id = NEW.id AND deleted_at IS NULL;
    IF d <> c THEN
      RAISE EXCEPTION 'Journal % not balanced: debit % <> credit %', NEW.voucher_no, d, c;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ห้ามบันทึก/แก้ไขเอกสารในงวดที่ปิดแล้ว (Express: ISPRD.LOCKn)
CREATE OR REPLACE FUNCTION gl_check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_locked boolean; v_date date; j jsonb;
BEGIN
  j := to_jsonb(NEW);
  v_date := COALESCE((j->>'voucher_date')::date, (j->>'doc_date')::date);
  SELECT p.is_locked INTO v_locked FROM gl_period p
   WHERE p.company_id = NEW.company_id AND v_date BETWEEN p.start_date AND p.end_date AND p.deleted_at IS NULL
   ORDER BY p.period_no LIMIT 1;
  IF COALESCE(v_locked, false) AND current_setting('app.allow_locked_period', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Period is locked for date %', v_date USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
"""

PG_VIEWS = r"""
-- ---------------------------------------------------------------- Views (แทนยอดสะสมที่ Express เก็บในแฟ้มหลัก)
-- ลูกหนี้คงค้างรายใบ (แทน ARMAS.BALANCE / ARTRN.REMAMT) · ยอดตัด (settled) เป็นบวกเสมอ ใบลดหนี้คงค้าง = −(ยอด − ที่ตัดแล้ว) · ไม่นับใบเสร็จ/ใบสำคัญที่ยกเลิก
CREATE OR REPLACE VIEW v_ar_outstanding AS
SELECT h.company_id, h.customer_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date,
       CASE WHEN h.doc_class = 'CN' THEN -h.net_amount ELSE h.net_amount END AS amount,
       COALESCE(s.settled, 0) AS settled,
       CASE WHEN h.doc_class = 'CN' THEN -(h.net_amount - COALESCE(s.settled, 0)) ELSE h.net_amount - COALESCE(s.settled, 0) END AS outstanding
FROM doc_header h
LEFT JOIN (SELECT s.invoice_header_id, sum(s.amount) settled FROM doc_settlement s
             LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
            WHERE s.deleted_at IS NULL AND COALESCE(p.doc_status, 'N') <> 'C' AND COALESCE(j.doc_status, 'N') <> 'C' GROUP BY 1) s
       ON s.invoice_header_id = h.id
WHERE h.module = 'AR' AND h.doc_class IN ('IV','DR','CN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- เจ้าหนี้คงค้างรายใบ
CREATE OR REPLACE VIEW v_ap_outstanding AS
SELECT h.company_id, h.supplier_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date,
       CASE WHEN h.doc_class = 'DN' THEN -h.net_amount ELSE h.net_amount END AS amount,
       COALESCE(s.settled, 0) AS settled,
       CASE WHEN h.doc_class = 'DN' THEN -(h.net_amount - COALESCE(s.settled, 0)) ELSE h.net_amount - COALESCE(s.settled, 0) END AS outstanding
FROM doc_header h
LEFT JOIN (SELECT s.invoice_header_id, sum(s.amount) settled FROM doc_settlement s
             LEFT JOIN doc_header p ON p.id = s.payment_header_id LEFT JOIN gl_journal j ON j.id = s.payment_journal_id
            WHERE s.deleted_at IS NULL AND COALESCE(p.doc_status, 'N') <> 'C' AND COALESCE(j.doc_status, 'N') <> 'C' GROUP BY 1) s
       ON s.invoice_header_id = h.id
WHERE h.module = 'AP' AND h.doc_class IN ('RR','CP','DN') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- มัดจำคงเหลือรายใบ (AI/AE) = ยอดมัดจำ (ตามประเภทราคาของใบมัดจำ) − ที่หักในบิลแล้ว (doc_link DEPOSIT ไปเอกสารที่ไม่ยกเลิก)
CREATE OR REPLACE VIEW v_deposit_outstanding AS
SELECT h.company_id, h.module, h.customer_id, h.supplier_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date, h.price_type,
       h.amount, COALESCE(u.used, 0) AS used, h.amount - COALESCE(u.used, 0) AS outstanding
FROM doc_header h
LEFT JOIN (SELECT l.from_header_id, sum(l.amount) used FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
            WHERE l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL GROUP BY 1) u
       ON u.from_header_id = h.id
WHERE h.doc_class IN ('AI','AE') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;

-- งบทดลองรายงวด (แทน GLBAL)
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT j.company_id, j.period_id, l.account_id, l.department_id,
       sum(l.debit) AS debit, sum(l.credit) AS credit, sum(l.debit - l.credit) AS net
FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
WHERE j.doc_status = 'N' AND j.deleted_at IS NULL
GROUP BY 1,2,3,4;

-- ยอดคงเหลือสินค้าจากบัญชีคุมสินค้า (ตรวจกับ inv_stock_balance)
CREATE OR REPLACE VIEW v_stock_from_ledger AS
SELECT company_id, item_id, warehouse_id, sum(qty) AS qty, sum(value) AS value
FROM inv_stock_ledger WHERE deleted_at IS NULL GROUP BY 1,2,3;
"""

# ---------------------------------------------------------------- SQLite
def gen_lite():
    L = []
    L.append('-- =====================================================================')
    L.append('-- ฐานข้อมูลเครื่องลูก (ทำงานออฟไลน์) — SQLite 3.35+')
    L.append('-- สร้างอัตโนมัติจาก spec.py — ตารางเหมือนเซิร์ฟเวอร์ทุกคอลัมน์ (ชื่อเดียวกัน) เพื่อให้ซิงก์ตรงตัว')
    L.append('-- ชนิดข้อมูล: uuid/ข้อความ/วันที่ = TEXT (ISO-8601), จำนวนเงิน/จำนวน = TEXT ทศนิยมแบบตรงตัว (เช่น "1234.50")')
    L.append('--             ห้ามเก็บเงินเป็น REAL เพราะทศนิยมคลาดเคลื่อน; boolean = INTEGER 0/1')
    L.append('-- =====================================================================')
    L.append('PRAGMA foreign_keys = ON;')
    L.append('PRAGMA journal_mode = WAL;')
    L.append('')
    lite_tables = [t for t in TABLES if t.sync in ('both', 'client')]
    names = {t.name for t in lite_tables}
    for t in lite_tables:
        cols = all_cols(t)
        L.append(f'-- {t.name}: {t.th}')
        L.append(f'CREATE TABLE IF NOT EXISTS {t.name} (')
        defs = []
        for c in cols:
            s = f'  {c.name} {lite_type(c.type)}'
            if c.name == pk_of(t): s += ' PRIMARY KEY'
            if c.nn and c.name != pk_of(t): s += ' NOT NULL'
            if c.d is not None:
                d = c.d
                if d == 'now()': d = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
                elif d == 'true': d = '1'
                elif d == 'false': d = '0'
                elif re.fullmatch(r'-?\d+(\.\d+)?', d) and lite_type(c.type) == 'TEXT': d = f"'{d}'"
                s += f' DEFAULT {d}'
            if c.chk:
                chk = c.chk
                s += f' CHECK ({chk})'
            if c.fk and c.fk in names:
                s += f' REFERENCES {c.fk}(id) DEFERRABLE INITIALLY DEFERRED'
            defs.append(s)
        if t.name == 'gl_journal_line':
            defs.append("  CHECK (CAST(debit AS NUMERIC) >= 0 AND CAST(credit AS NUMERIC) >= 0 AND (CAST(debit AS NUMERIC) = 0 OR CAST(credit AS NUMERIC) = 0))")
        L.append(',\n'.join(defs))
        L.append(');')
        for u in t.uniq:
            nm = f'uq_{t.name}_' + '_'.join(x.replace('_id','') for x in u)
            cols_u = ', '.join(f"IFNULL({x},'')" if x in ('tenant_id','branch_id','line_id','department_id','customer_id','payment_header_id','payment_journal_id','bank_account_id') else x for x in u)
            where = ' WHERE deleted_at IS NULL' if t.common else ''
            L.append(f'CREATE UNIQUE INDEX IF NOT EXISTS {nm} ON {t.name} ({cols_u}){where};')
        for i in t.idx:
            nm = f'ix_{t.name}_' + '_'.join(x.replace('_id','') for x in i)
            L.append(f'CREATE INDEX IF NOT EXISTS {nm} ON {t.name} ({", ".join(i)});')
        L.append('')
    # outbox triggers for synced (both) tables
    L.append('-- ---------------------------------------------------------------- Outbox triggers')
    L.append("-- ทุกการเพิ่ม/แก้ในเครื่องลูกจะถูกคิวลง sync_outbox อัตโนมัติ")
    L.append("-- ตอนนำข้อมูลจากเซิร์ฟเวอร์เข้ามา ให้แอปตั้ง sync_state('applying_remote')='1' ก่อน เพื่อไม่ให้คิวกลับขึ้นไป")
    L.append("-- แอปตั้ง sync_state('current_tx') = id ของหัวเอกสาร ก่อนบันทึกหัว+บรรทัด เพื่อให้ส่งเป็นชุดเดียวกัน")
    UUID = "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-7'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))"
    for t in lite_tables:
        if not t.common or t.sync != 'both': continue
        cols = [c.name for c in all_cols(t)]
        obj = ', '.join(f"'{c}', NEW.{c}" for c in cols)
        # json_object max 127 args per call in older sqlite builds -> split
        parts = []
        chunk = []
        for c in cols:
            chunk.append(f"'{c}', NEW.{c}")
            if len(chunk) == 60:
                parts.append('json_object(' + ', '.join(chunk) + ')'); chunk = []
        if chunk: parts.append('json_object(' + ', '.join(chunk) + ')')
        payload = parts[0] if len(parts) == 1 else 'json_patch(' + parts[0] + ', ' + (parts[1] if len(parts)==2 else 'json_patch(' + parts[1] + ', ' + parts[2] + ')') + ')'
        for ev in ('INSERT', 'UPDATE'):
            extra = ' AND NEW.row_version <> OLD.row_version' if ev == 'UPDATE' else ''
            L.append(f"""CREATE TRIGGER IF NOT EXISTS trg_{t.name}_{ev.lower()}_outbox AFTER {ev} ON {t.name}
WHEN IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'{extra}
BEGIN
  INSERT INTO sync_outbox(id, seq, table_name, row_id, op, base_version, payload, tx_id, created_at)
  VALUES ({UUID}, (SELECT IFNULL(MAX(seq),0)+1 FROM sync_outbox), '{t.name}', NEW.id,
          CASE WHEN NEW.deleted_at IS NULL THEN 'U' ELSE 'D' END,
          {'OLD.row_version' if ev=='UPDATE' else 'NULL'}, {payload},
          IFNULL((SELECT value FROM sync_state WHERE key='current_tx'), NEW.id), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;""")
            if ev == 'UPDATE':
                pass
        L.append(f"""CREATE TRIGGER IF NOT EXISTS trg_{t.name}_ver AFTER UPDATE ON {t.name}
WHEN NEW.row_version = OLD.row_version AND IFNULL((SELECT value FROM sync_state WHERE key='applying_remote'),'0') <> '1'
BEGIN
  UPDATE {t.name} SET row_version = OLD.row_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;""")
    open(os.path.join(OUT, 'client_sqlite.sql'), 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')

# ---------------------------------------------------------------- Data dictionary
def gen_dict():
    L = ['# พจนานุกรมข้อมูล — ระบบใหม่ (PostgreSQL / SQLite)', '',
         '> สร้างอัตโนมัติจาก `spec.py` · คอลัมน์ "Express" คือฟิลด์ต้นทางในโปรแกรม Express ที่ใช้ย้ายข้อมูล',
         '> ทุกตาราง (ยกเว้นที่ระบุ) มีคอลัมน์มาตรฐาน: `id` `company_id` `created_at` `created_by` `updated_at` `updated_by` `row_version` `deleted_at` `origin_device_id`', '',
         '**ขอบเขตการซิงก์:** `both` = มีทั้งเซิร์ฟเวอร์และเครื่องลูก (ซิงก์สองทาง) · `server` = เฉพาะเซิร์ฟเวอร์ (คำนวณ/สรุป) · `client` = เฉพาะเครื่องลูก', '']
    L.append('## สารบัญ'); L.append('')
    for m, mth in MODULES.items():
        ts = [t for t in TABLES if t.module == m]
        if not ts: continue
        L.append(f'- **{m}** — {mth}: ' + ', '.join(f'[`{t.name}`](#{t.name})' for t in ts))
    L.append('')
    for m, mth in MODULES.items():
        ts = [t for t in TABLES if t.module == m]
        if not ts: continue
        L.append(f'## {m} — {mth}'); L.append('')
        for t in ts:
            L.append(f'### {t.name}')
            L.append(f'{t.th}  ')
            L.append(f'ซิงก์: `{t.sync}`' + (f' · Express: **{t.express}**' if t.express else ''))
            if t.note: L.append(f'\n> {t.note}')
            L.append('')
            L.append('| คอลัมน์ | ชนิด (PostgreSQL) | ว่างได้ | อ้างอิง | คำอธิบาย | Express |')
            L.append('|---|---|---|---|---|---|')
            for c in t.cols:
                L.append(f'| `{c.name}` | {pg_type(c.type)} | {"" if c.nn else "✓"} | {c.fk or ""} | {c.th.replace("|","/")}{" — ค่าเริ่มต้น " + c.d if c.d else ""} | {c.src.replace("|","/")} |')
            keys = []
            if t.uniq: keys.append('Unique: ' + '; '.join('(' + ', '.join(u) + ')' for u in t.uniq))
            if t.idx: keys.append('Index: ' + '; '.join('(' + ', '.join(u) + ')' for u in t.idx))
            if keys: L.append(''); L.append(' · '.join(keys))
            L.append('')
    open(os.path.join(ROOT, 'docs', 'db', 'พจนานุกรมข้อมูล.md'), 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')

# ---------------------------------------------------------------- ER (mermaid)
def gen_er():
    groups = {
     'ภาพรวมแกนหลัก': ['sys_company','sys_branch','sys_device','md_doc_type','md_doc_number_block','doc_header','doc_line','doc_settlement','doc_payment','doc_link','md_payment_method','fin_cheque','gl_journal','gl_journal_line','gl_account','tax_vat_entry','tax_wht_entry','inv_stock_ledger'],
     'แฟ้มข้อมูลหลัก': ['md_customer','md_customer_ship_to','md_supplier','md_salesperson','md_item','md_item_account_group','md_item_bom','md_item_price_break','md_unit','md_warehouse','md_department','gl_account','md_bank_account','md_bank'],
     'ขาย-ซื้อ-รับชำระ': ['doc_header','doc_line','doc_note','doc_link','doc_bill_item','doc_settlement','doc_payment','md_payment_method','fin_cheque','fin_cheque_event','md_customer','md_supplier'],
     'สินค้าคงคลัง': ['md_item','md_warehouse','doc_line','inv_stock_ledger','inv_cost_layer','inv_cost_consumption','inv_stock_balance','inv_stock_count'],
     'บัญชีแยกประเภท-ภาษี': ['gl_fiscal_year','gl_period','gl_account','gl_journal_book','gl_journal','gl_journal_line','gl_balance','gl_default_account','gl_journal_route','gl_posting_rule','md_doc_type','md_doc_type_account','tax_vat_entry','tax_wht_entry','doc_header'],
     'ทรัพย์สินถาวร': ['fa_asset','fa_depreciation','md_asset_account_group','gl_account','gl_period','gl_journal'],
     'ผู้ใช้-สิทธิ์-ซิงก์': ['sys_company','sys_branch','sys_user','sys_user_group','sys_user_company','sys_menu','sys_permission','sys_device','md_doc_number_block','sync_conflict'],
    }
    L = ['# ER Diagram — ระบบใหม่', '', '> สร้างอัตโนมัติจาก spec.py · แสดงเฉพาะความสัมพันธ์ภายในกลุ่ม', '']
    for g, names in groups.items():
        s = set(names)
        L.append(f'## {g}'); L.append(''); L.append('```mermaid'); L.append('erDiagram')
        seen = set()
        for n in names:
            t = TBL[n]
            for c in t.cols:
                if c.fk in s and (n, c.fk, c.name) not in seen:
                    seen.add((n, c.fk, c.name))
                    card = '||--o{' if c.nn else '|o--o{'
                    L.append(f'    {c.fk} {card} {n} : "{c.name}"')
        L.append('```'); L.append('')
    open(os.path.join(ROOT, 'docs', 'db', 'ER.md'), 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')

def ts_type(t):
    if t in ('int','smallint','bigserial'): return 'number'
    if t == 'bigint': return 'number'          # ตั้ง parser ให้ int8 เป็น number ทั้ง pg และ PGlite
    if t == 'bool': return 'boolean'
    if t == 'json': return 'unknown'
    return 'string'                            # uuid ข้อความ วันที่ numeric (เงินเป็นข้อความทศนิยม)

def gen_ts():
    L = ['// สร้างอัตโนมัติจาก db/spec/spec.py ด้วย `pnpm db:gen` — ห้ามแก้ไฟล์นี้ด้วยมือ',
         "import type { ColumnType } from 'kysely';",
         'type Gen<T> = ColumnType<T, T | undefined, T>;', '']
    for t in TABLES:
        if t.sync == 'client': continue
        L.append(f'/** {t.th} */')
        L.append(f'export interface {"".join(p.capitalize() for p in t.name.split("_"))}Table {{')
        for c in all_cols(t):
            ty = ts_type(c.type)
            has_default = c.d is not None or (c.name == 'id' and t.common) or c.type == 'bigserial'
            if not c.nn: ty = f'{ty} | null'
            if has_default or not c.nn: ty = f'Gen<{ty}>'
            doc = (c.th or '').replace('*/', '')
            L.append(f'  /** {doc} */' if doc else '')
            L.append(f'  {c.name}: {ty};')
        L.append('}'); L.append('')
    L.append('export interface DB {')
    for t in TABLES:
        if t.sync == 'client': continue
        L.append(f'  {t.name}: {"".join(p.capitalize() for p in t.name.split("_"))}Table;')
    L.append('}')
    open(os.path.join(OUT, 'db-types.ts'), 'w', encoding='utf-8', newline='').write('\n'.join(x for x in L if x != '') + '\n')

if __name__ == '__main__':
    gen_pg(); gen_lite(); gen_dict(); gen_er(); gen_ts()
    print('tables', len(TABLES), 'columns', sum(len(all_cols(t)) for t in TABLES))
