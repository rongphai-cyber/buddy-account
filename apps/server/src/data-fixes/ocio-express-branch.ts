/**
 * แก้ข้อมูลครั้งเดียว: สาขาของเอกสารที่ย้ายมาจาก Express ของบริษัท OCIO-0505566016991 (HANDOFF 196)
 * เจ้าของ 26/11/2569: "เลขชุด ที่ย้ายมา แต่จริงคือสาขา เช่น INV03-006 คือของสาขา 00003 INV01-0039 คือของสาขา 00001 IV02-0049 คือของสาขา 00002
 *   หรือ IV00-0045, IVBK-001, IVEX-0-109 หรือที่ไม่มีเลขติดกับตัวอักษร คือของสำนักงานใหญ่" · "ทำครั้งนี้ครั้งเดียวกับบริษัทฯ นี้เท่านั้น … แค่แก้ข้อมูลให้ก็พอ"
 *
 * ใช้ 2 ที่ (ข้อความ SQL เดียวกันทุกตัวอักษร — ทดสอบตรวจ):
 *  - db/migrations/0081_ocio_express_branch_fix.sql (รันตอน deploy)
 *  - ขั้นปรับข้อมูล n:81 ตอนนำแฟ้มสำรองก่อนรุ่นนี้กลับ (backup.ts COMPANY_STEPS)
 *
 * กติกา: เฉพาะเอกสาร/ใบสำคัญที่ย้ายมาจาก Express (doc_header.express_rectype หรือใบสำคัญ from_express ของเอกสาร · HANDOFF 193)
 *  เลขที่ขึ้นต้นด้วยตัวอักษรแล้วตามด้วยเลข 2 หลัก NN (01–99) และตัวถัดไปไม่ใช่ตัวเลข (IV01-0039 · INV03-006) → สาขาที่ tax_branch_no = 000NN
 *  นอกนั้น (IV00-… · IVBK-… · IVEX-… · IV6801001 · RE…) = สำนักงานใหญ่ ตามเดิม ไม่แตะ
 *  ย้ายพร้อมกัน: หัวเอกสาร · ใบสำคัญของเอกสาร (ทุกใบที่อ้างเอกสารนั้น) · ภาษีขาย/ซื้อ · ภาษีหัก ณ ที่จ่าย · เช็ค — เปลี่ยนเฉพาะ branch_id
 *  ไม่มีสาขาที่ต้องใช้ หรือมีเลขที่สาขาซ้ำ = ยกเลิกทั้งหมด (RAISE) ไม่เดา · บริษัทอื่น/ไม่มีบริษัทนี้ = ไม่ทำอะไร · รันซ้ำ = 0 แถว
 *  ปิด trigger เฉพาะระหว่างคำสั่ง (เหมือน 0080): ไม่เพิ่มรุ่นแถว/เวลาแก้ไข ไม่ส่งเป็นการเปลี่ยนแปลงให้เครื่องสาขา ข้ามงวดปิด
 *  บันทึก sys_activity_log 1 แถว (SYS / BRANCH_FIX) จำนวนต่อสาขา + เลขที่เอกสารที่ย้าย — เฉพาะเมื่อมีการเปลี่ยน
 */
export const OCIO_COMPANY_CODE = 'OCIO-0505566016991';

export const OCIO_BRANCH_FIX_SQL = `DO $ocio196$
DECLARE
  co uuid;
  missing text;
  dup text;
  n_doc int := 0; n_jnl int := 0; n_vat int := 0; n_wht int := 0; n_chq int := 0;
BEGIN
  SELECT id INTO co FROM sys_company WHERE code = 'OCIO-0505566016991';
  IF co IS NULL THEN RETURN; END IF;

  DROP TABLE IF EXISTS ocio196_doc; DROP TABLE IF EXISTS ocio196_jnl; DROP TABLE IF EXISTS ocio196_moved;
  CREATE TEMP TABLE ocio196_doc (id uuid PRIMARY KEY, doc_no text, prefix text, tax_no text, branch_id uuid);
  CREATE TEMP TABLE ocio196_jnl (id uuid PRIMARY KEY, voucher_no text, prefix text, tax_no text, branch_id uuid);
  CREATE TEMP TABLE ocio196_moved (kind text, tax_no text, prefix text, no text);

  -- เอกสารที่ย้ายมาจาก Express ที่เลขที่บอกสาขา
  INSERT INTO ocio196_doc (id, doc_no, prefix, tax_no)
  SELECT h.id, h.doc_no, substring(h.doc_no from '^([A-Za-z]+[0-9]{2})(?:[^0-9]|$)'), lpad(substring(h.doc_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0')
    FROM doc_header h
   WHERE h.company_id = co AND h.deleted_at IS NULL
     AND h.doc_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
     AND (h.express_rectype IS NOT NULL
          OR EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = co AND j.from_express AND (j.id = h.journal_id OR j.source_header_id = h.id)));

  -- ใบสำคัญของเอกสารเหล่านั้น (ทุกใบที่อ้างเอกสาร) ตามสาขาของเอกสาร
  INSERT INTO ocio196_jnl (id, voucher_no, prefix, tax_no)
  SELECT DISTINCT ON (j.id) j.id, j.voucher_no, d.prefix, d.tax_no
    FROM gl_journal j JOIN doc_header h ON h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id) JOIN ocio196_doc d ON d.id = h.id
   WHERE j.company_id = co AND j.deleted_at IS NULL
   ORDER BY j.id, d.tax_no;
  -- ใบสำคัญที่ย้ายมาที่ไม่มีเอกสาร (บันทึกใน GL ของ Express) ที่เลขที่บอกสาขา
  INSERT INTO ocio196_jnl (id, voucher_no, prefix, tax_no)
  SELECT j.id, j.voucher_no, substring(j.voucher_no from '^([A-Za-z]+[0-9]{2})(?:[^0-9]|$)'), lpad(substring(j.voucher_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0')
    FROM gl_journal j
   WHERE j.company_id = co AND j.deleted_at IS NULL AND j.from_express
     AND j.voucher_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
     AND NOT EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id))
  ON CONFLICT (id) DO NOTHING;

  -- สาขาปลายทางต้องมีจริงและไม่ซ้ำ — ไม่เดา
  SELECT string_agg(DISTINCT t.tax_no, ', ' ORDER BY t.tax_no) INTO missing
    FROM (SELECT tax_no FROM ocio196_doc UNION SELECT tax_no FROM ocio196_jnl) t
   WHERE NOT EXISTS (SELECT 1 FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = t.tax_no);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'HANDOFF 196: OCIO-0505566016991 has no branch with tax branch no % — add the branch, then deploy again (nothing was changed) / บริษัทนี้ไม่มีสาขาเลขที่ % — เพิ่มสาขาก่อนแล้ว deploy ใหม่ (ยังไม่ได้แก้ข้อมูลใด ๆ)', missing, missing;
  END IF;
  SELECT string_agg(x.tax_branch_no, ', ' ORDER BY x.tax_branch_no) INTO dup
    FROM (SELECT b.tax_branch_no FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL GROUP BY b.tax_branch_no HAVING count(*) > 1) x
   WHERE x.tax_branch_no IN (SELECT tax_no FROM ocio196_doc UNION SELECT tax_no FROM ocio196_jnl);
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'HANDOFF 196: OCIO-0505566016991 has more than one branch with tax branch no % (nothing was changed) / มีหลายสาขาที่ใช้เลขที่สาขา % (ยังไม่ได้แก้ข้อมูลใด ๆ)', dup, dup;
  END IF;
  UPDATE ocio196_doc d SET branch_id = b.id FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = d.tax_no;
  UPDATE ocio196_jnl x SET branch_id = b.id FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = x.tax_no;

  -- เปลี่ยนเฉพาะ branch_id (ไม่แตะยอดเงิน เลขที่ วันที่) · ปิด trigger เฉพาะช่วงนี้
  -- FK ทุกตัวเป็น DEFERRABLE INITIALLY DEFERRED: ตรวจที่ค้างอยู่ให้เสร็จก่อน ALTER TABLE (ไม่งั้น "pending trigger events") แล้วคืนเป็น DEFERRED ตามเดิม
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE doc_header DISABLE TRIGGER USER;
  ALTER TABLE gl_journal DISABLE TRIGGER USER;
  ALTER TABLE tax_vat_entry DISABLE TRIGGER USER;
  ALTER TABLE tax_wht_entry DISABLE TRIGGER USER;
  ALTER TABLE fin_cheque DISABLE TRIGGER USER;

  WITH u AS (UPDATE doc_header h SET branch_id = d.branch_id FROM ocio196_doc d
              WHERE h.id = d.id AND h.company_id = co AND h.branch_id IS DISTINCT FROM d.branch_id RETURNING d.tax_no, d.prefix, d.doc_no)
  INSERT INTO ocio196_moved SELECT 'doc', tax_no, prefix, doc_no FROM u;
  GET DIAGNOSTICS n_doc = ROW_COUNT;
  WITH u AS (UPDATE gl_journal j SET branch_id = x.branch_id FROM ocio196_jnl x
              WHERE j.id = x.id AND j.company_id = co AND j.branch_id IS DISTINCT FROM x.branch_id RETURNING x.tax_no, x.prefix, x.voucher_no)
  INSERT INTO ocio196_moved SELECT 'journal', tax_no, prefix, voucher_no FROM u;
  GET DIAGNOSTICS n_jnl = ROW_COUNT;
  WITH t AS (SELECT v.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM tax_vat_entry v
               LEFT JOIN ocio196_doc d ON d.id = v.header_id LEFT JOIN ocio196_jnl x ON x.id = v.journal_id
              WHERE v.company_id = co AND v.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
       u AS (UPDATE tax_vat_entry v SET branch_id = t.branch_id FROM t WHERE v.id = t.id AND v.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, v.doc_no)
  INSERT INTO ocio196_moved SELECT 'vat', tax_no, NULL, doc_no FROM u;
  GET DIAGNOSTICS n_vat = ROW_COUNT;
  WITH t AS (SELECT w.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM tax_wht_entry w
               LEFT JOIN ocio196_doc d ON d.id = w.header_id LEFT JOIN ocio196_jnl x ON x.id = w.journal_id
              WHERE w.company_id = co AND w.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
       u AS (UPDATE tax_wht_entry w SET branch_id = t.branch_id FROM t WHERE w.id = t.id AND w.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, w.certificate_no)
  INSERT INTO ocio196_moved SELECT 'wht', tax_no, NULL, certificate_no FROM u;
  GET DIAGNOSTICS n_wht = ROW_COUNT;
  WITH t AS (SELECT f.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM fin_cheque f
               LEFT JOIN ocio196_doc d ON d.id = f.source_header_id LEFT JOIN ocio196_jnl x ON x.id = f.source_journal_id
              WHERE f.company_id = co AND f.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
       u AS (UPDATE fin_cheque f SET branch_id = t.branch_id FROM t WHERE f.id = t.id AND f.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, f.cheque_no)
  INSERT INTO ocio196_moved SELECT 'cheque', tax_no, NULL, cheque_no FROM u;
  GET DIAGNOSTICS n_chq = ROW_COUNT;

  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE doc_header ENABLE TRIGGER USER;
  ALTER TABLE gl_journal ENABLE TRIGGER USER;
  ALTER TABLE tax_vat_entry ENABLE TRIGGER USER;
  ALTER TABLE tax_wht_entry ENABLE TRIGGER USER;
  ALTER TABLE fin_cheque ENABLE TRIGGER USER;
  SET CONSTRAINTS ALL DEFERRED;

  IF n_doc + n_jnl + n_vat + n_wht + n_chq > 0 THEN
    INSERT INTO sys_activity_log (company_id, module, action, table_name, detail)
    SELECT co, 'SYS', 'BRANCH_FIX', 'doc_header', jsonb_build_object(
      'handoff', 196, 'by', 'migration 0081 (owner 26/11/2569)',
      'rule', 'Express doc no letters+NN (01-99) = branch tax no 000NN; other numbers stay at head office',
      'docs', n_doc, 'journals', n_jnl, 'vat', n_vat, 'wht', n_wht, 'cheques', n_chq,
      'by_branch', (SELECT jsonb_object_agg(b.tax_no, b.detail) FROM (
          SELECT m.tax_no, jsonb_build_object(
            'docs', count(*) FILTER (WHERE m.kind = 'doc'), 'journals', count(*) FILTER (WHERE m.kind = 'journal'),
            'vat', count(*) FILTER (WHERE m.kind = 'vat'), 'wht', count(*) FILTER (WHERE m.kind = 'wht'), 'cheques', count(*) FILTER (WHERE m.kind = 'cheque'),
            'prefixes', (SELECT jsonb_object_agg(p.prefix, p.n) FROM (SELECT m2.prefix, count(*) AS n FROM ocio196_moved m2 WHERE m2.kind = 'doc' AND m2.tax_no = m.tax_no GROUP BY m2.prefix) p),
            'doc_nos', (SELECT jsonb_agg(m3.no ORDER BY m3.no) FROM ocio196_moved m3 WHERE m3.kind = 'doc' AND m3.tax_no = m.tax_no)) AS detail
            FROM ocio196_moved m GROUP BY m.tax_no) b));
  END IF;

  DROP TABLE ocio196_doc; DROP TABLE ocio196_jnl; DROP TABLE ocio196_moved;
END
$ocio196$;`;
