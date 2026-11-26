-- 0081 แก้ข้อมูลครั้งเดียว: สาขาของเอกสารที่ย้ายมาจาก Express ของบริษัท OCIO-0505566016991 เท่านั้น (HANDOFF 196)
-- เจ้าของ 26/11/2569: "เลขชุด ที่ย้ายมา แต่จริงคือสาขา เช่น INV03-006 คือของสาขา 00003 INV01-0039 คือของสาขา 00001 IV02-0049 คือของสาขา 00002
--   หรือ IV00-0045, IVBK-001, IVEX-0-109 หรือที่ไม่มีเลขติดกับตัวอักษร คือของสำนักงานใหญ่" · "ทำครั้งนี้ครั้งเดียวกับบริษัทฯ นี้เท่านั้น … แค่แก้ข้อมูลให้ก็พอ"
--   ใบเสร็จ/ใบจ่ายชำระ: "ย้ายตามใบขาย" (ทุกใบที่ตัดชำระอยู่สาขาเดียว → สาขานั้น · หลายสาขา = สำนักงานใหญ่)
-- Express ไม่มีช่องสาขารายเอกสาร (ARTRN/APTRN/ISVAT/STCRD/GLJNL มีแค่ DEPCOD = แผนก · BKMAS/BKTRN.BRANCH = สาขาธนาคาร) → ใช้คำนำหน้าเลขที่ตามเจ้าของ
-- ไม่มีบริษัทนี้ (DEMO/เครื่องอื่น/ทดสอบ) = ไม่ทำอะไร · ไม่มีสาขาเลขที่ที่ต้องใช้ = ไม่แก้อะไร + บันทึก BRANCH_FIX_SKIPPED (ไม่ทำให้ deploy ล้ม) · รันซ้ำ = 0 แถว
-- สร้างฟังก์ชันช่วยครั้งเดียว ocio196_branch_fix() (ไม่อยู่ใน spec — ไม่ใช่ส่วนของโปรแกรม) · ทำซ้ำภายหลังได้ด้วย migration บรรทัดเดียว: SELECT ocio196_branch_fix();
-- ข้อความ SQL เดียวกันทุกตัวอักษรกับ apps/server/src/data-fixes/ocio-express-branch.ts (ขั้นนำแฟ้มสำรองกลับ n:81) — ทดสอบตรวจ
CREATE OR REPLACE FUNCTION ocio196_branch_fix() RETURNS text LANGUAGE plpgsql AS $ocio196$
DECLARE
  co uuid;
  problem text;
  phase int;
  n_doc int; n_jnl int; n_vat int; n_wht int; n_chq int;
  t_doc int := 0; t_jnl int := 0; t_vat int := 0; t_wht int := 0; t_chq int := 0;
BEGIN
  SELECT id INTO co FROM sys_company WHERE code = 'OCIO-0505566016991';
  IF co IS NULL THEN RETURN 'no company'; END IF;

  DROP TABLE IF EXISTS ocio196_doc; DROP TABLE IF EXISTS ocio196_jnl; DROP TABLE IF EXISTS ocio196_moved;
  CREATE TEMP TABLE ocio196_doc (id uuid PRIMARY KEY, no text, prefix text, tax_no text, branch_id uuid);
  CREATE TEMP TABLE ocio196_jnl (id uuid PRIMARY KEY, no text, prefix text, tax_no text, branch_id uuid);
  CREATE TEMP TABLE ocio196_moved (phase int, kind text, tax_no text, prefix text, no text);

  -- ขั้น 1: ตรวจสาขาปลายทางของเลขชุดก่อน — ไม่มี/ซ้ำ = ไม่แก้อะไรเลย (ไม่ล้ม deploy)
  WITH need AS (
    SELECT DISTINCT lpad(substring(h.doc_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0') AS tax_no FROM doc_header h
     WHERE h.company_id = co AND h.deleted_at IS NULL AND h.doc_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
       AND (h.express_rectype IS NOT NULL OR EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = co AND j.from_express AND (j.id = h.journal_id OR j.source_header_id = h.id)))
    UNION
    SELECT DISTINCT lpad(substring(j.voucher_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0') FROM gl_journal j
     WHERE j.company_id = co AND j.deleted_at IS NULL AND j.from_express AND j.voucher_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
       AND NOT EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id)))
  SELECT string_agg(x.msg, '; ' ORDER BY x.msg) INTO problem FROM (
    SELECT 'missing branch ' || n.tax_no AS msg FROM need n
     WHERE NOT EXISTS (SELECT 1 FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = n.tax_no)
    UNION ALL
    SELECT 'duplicate branch ' || n.tax_no FROM need n
     WHERE (SELECT count(*) FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = n.tax_no) > 1) x;
  IF problem IS NOT NULL THEN
    INSERT INTO sys_activity_log (company_id, module, action, table_name, detail)
    VALUES (co, 'SYS', 'BRANCH_FIX_SKIPPED', 'doc_header', jsonb_build_object('handoff', 196, 'reason', problem,
      'fix', 'add the branches (tax branch no 000NN), then deploy a migration with: SELECT ocio196_branch_fix();'));
    RAISE NOTICE 'HANDOFF 196: OCIO-0505566016991 branch fix skipped (nothing changed): %', problem;
    DROP TABLE ocio196_doc; DROP TABLE ocio196_jnl; DROP TABLE ocio196_moved;
    RETURN 'skipped: ' || problem;
  END IF;

  -- เปลี่ยนเฉพาะ branch_id (ไม่แตะยอดเงิน เลขที่ วันที่) · ปิด trigger เฉพาะช่วงนี้
  -- FK ทุกตัวเป็น DEFERRABLE INITIALLY DEFERRED: ตรวจที่ค้างอยู่ให้เสร็จก่อน ALTER TABLE (ไม่งั้น "pending trigger events") แล้วคืนเป็น DEFERRED ตามเดิม
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE doc_header DISABLE TRIGGER USER;
  ALTER TABLE gl_journal DISABLE TRIGGER USER;
  ALTER TABLE tax_vat_entry DISABLE TRIGGER USER;
  ALTER TABLE tax_wht_entry DISABLE TRIGGER USER;
  ALTER TABLE fin_cheque DISABLE TRIGGER USER;

  FOR phase IN 1..3 LOOP
    TRUNCATE ocio196_doc; TRUNCATE ocio196_jnl;
    IF phase = 1 THEN
      -- เอกสารที่เลขชุดบอกสาขา
      INSERT INTO ocio196_doc (id, no, prefix, tax_no)
      SELECT h.id, h.doc_no, substring(h.doc_no from '^([A-Za-z]+[0-9]{2})(?:[^0-9]|$)'), lpad(substring(h.doc_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0')
        FROM doc_header h
       WHERE h.company_id = co AND h.deleted_at IS NULL AND h.doc_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
         AND (h.express_rectype IS NOT NULL OR EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = co AND j.from_express AND (j.id = h.journal_id OR j.source_header_id = h.id)));
      -- ใบสำคัญ GL ที่ย้ายมาไม่มีเอกสาร ที่เลขชุดบอกสาขา
      INSERT INTO ocio196_jnl (id, no, prefix, tax_no)
      SELECT j.id, j.voucher_no, substring(j.voucher_no from '^([A-Za-z]+[0-9]{2})(?:[^0-9]|$)'), lpad(substring(j.voucher_no from '^[A-Za-z]+([0-9]{2})(?:[^0-9]|$)'), 5, '0')
        FROM gl_journal j
       WHERE j.company_id = co AND j.deleted_at IS NULL AND j.from_express AND j.voucher_no ~ '^[A-Za-z]+(0[1-9]|[1-9][0-9])([^0-9]|$)'
         AND NOT EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id));
      UPDATE ocio196_doc d SET branch_id = b.id FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = d.tax_no;
      UPDATE ocio196_jnl x SET branch_id = b.id FROM sys_branch b WHERE b.company_id = co AND b.deleted_at IS NULL AND b.tax_branch_no = x.tax_no;
    ELSIF phase = 2 THEN
      -- ใบรับ/จ่ายชำระที่ย้ายมา: ทุกใบที่ตัดชำระอยู่สาขาเดียว → สาขานั้น ("ย้ายตามใบขาย")
      INSERT INTO ocio196_doc (id, no, prefix, branch_id)
      SELECT p.id, p.doc_no, p.doc_class, (array_agg(DISTINCT i.branch_id))[1]
        FROM doc_header p JOIN doc_settlement s ON s.payment_header_id = p.id AND s.deleted_at IS NULL
        JOIN doc_header i ON i.id = s.invoice_header_id AND i.deleted_at IS NULL
       WHERE p.company_id = co AND p.deleted_at IS NULL
         AND (p.express_rectype IS NOT NULL OR EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = co AND j.from_express AND (j.id = p.journal_id OR j.source_header_id = p.id)))
       GROUP BY p.id, p.doc_no, p.doc_class HAVING count(DISTINCT i.branch_id) = 1;
      INSERT INTO ocio196_jnl (id, no, prefix, branch_id)
      SELECT j.id, j.voucher_no, 'settle', (array_agg(DISTINCT i.branch_id))[1]
        FROM gl_journal j JOIN doc_settlement s ON s.payment_journal_id = j.id AND s.deleted_at IS NULL
        JOIN doc_header i ON i.id = s.invoice_header_id AND i.deleted_at IS NULL
       WHERE j.company_id = co AND j.deleted_at IS NULL AND j.from_express
         AND NOT EXISTS (SELECT 1 FROM doc_header h WHERE h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id))
       GROUP BY j.id, j.voucher_no HAVING count(DISTINCT i.branch_id) = 1;
    ELSE
      -- ใบนำฝากเช็คที่ย้ายมา: เช็คทุกใบอยู่สาขาเดียว → สาขานั้น
      INSERT INTO ocio196_doc (id, no, prefix, branch_id)
      SELECT q.id, q.doc_no, q.doc_class, (array_agg(DISTINCT f.branch_id))[1]
        FROM doc_header q JOIN fin_cheque f ON f.deposit_header_id = q.id AND f.deleted_at IS NULL
       WHERE q.company_id = co AND q.deleted_at IS NULL
         AND (q.express_rectype IS NOT NULL OR EXISTS (SELECT 1 FROM gl_journal j WHERE j.company_id = co AND j.from_express AND (j.id = q.journal_id OR j.source_header_id = q.id)))
       GROUP BY q.id, q.doc_no, q.doc_class HAVING count(DISTINCT f.branch_id) = 1;
    END IF;
    UPDATE ocio196_doc d SET tax_no = b.tax_branch_no FROM sys_branch b WHERE b.id = d.branch_id AND d.tax_no IS NULL;
    UPDATE ocio196_jnl x SET tax_no = b.tax_branch_no FROM sys_branch b WHERE b.id = x.branch_id AND x.tax_no IS NULL;
    -- ใบสำคัญของเอกสาร (ทุกใบที่อ้างเอกสาร) ตามสาขาของเอกสาร
    INSERT INTO ocio196_jnl (id, no, prefix, tax_no, branch_id)
    SELECT DISTINCT ON (j.id) j.id, j.voucher_no, d.prefix, d.tax_no, d.branch_id
      FROM gl_journal j JOIN doc_header h ON h.company_id = co AND (h.id = j.source_header_id OR h.journal_id = j.id) JOIN ocio196_doc d ON d.id = h.id
     WHERE j.company_id = co AND j.deleted_at IS NULL
     ORDER BY j.id, d.tax_no
    ON CONFLICT (id) DO NOTHING;

    WITH u AS (UPDATE doc_header h SET branch_id = d.branch_id FROM ocio196_doc d
                WHERE h.id = d.id AND h.company_id = co AND h.branch_id IS DISTINCT FROM d.branch_id RETURNING d.tax_no, d.prefix, d.no)
    INSERT INTO ocio196_moved SELECT phase, 'doc', tax_no, prefix, no FROM u;
    GET DIAGNOSTICS n_doc = ROW_COUNT;
    WITH u AS (UPDATE gl_journal j SET branch_id = x.branch_id FROM ocio196_jnl x
                WHERE j.id = x.id AND j.company_id = co AND j.branch_id IS DISTINCT FROM x.branch_id RETURNING x.tax_no, x.prefix, x.no)
    INSERT INTO ocio196_moved SELECT phase, 'journal', tax_no, prefix, no FROM u;
    GET DIAGNOSTICS n_jnl = ROW_COUNT;
    WITH t AS (SELECT v.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM tax_vat_entry v
                 LEFT JOIN ocio196_doc d ON d.id = v.header_id LEFT JOIN ocio196_jnl x ON x.id = v.journal_id
                WHERE v.company_id = co AND v.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
         u AS (UPDATE tax_vat_entry v SET branch_id = t.branch_id FROM t WHERE v.id = t.id AND v.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, v.doc_no)
    INSERT INTO ocio196_moved SELECT phase, 'vat', tax_no, NULL, doc_no FROM u;
    GET DIAGNOSTICS n_vat = ROW_COUNT;
    WITH t AS (SELECT w.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM tax_wht_entry w
                 LEFT JOIN ocio196_doc d ON d.id = w.header_id LEFT JOIN ocio196_jnl x ON x.id = w.journal_id
                WHERE w.company_id = co AND w.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
         u AS (UPDATE tax_wht_entry w SET branch_id = t.branch_id FROM t WHERE w.id = t.id AND w.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, w.certificate_no)
    INSERT INTO ocio196_moved SELECT phase, 'wht', tax_no, NULL, certificate_no FROM u;
    GET DIAGNOSTICS n_wht = ROW_COUNT;
    WITH t AS (SELECT f.id, coalesce(d.branch_id, x.branch_id) AS branch_id, coalesce(d.tax_no, x.tax_no) AS tax_no FROM fin_cheque f
                 LEFT JOIN ocio196_doc d ON d.id = f.source_header_id LEFT JOIN ocio196_jnl x ON x.id = f.source_journal_id
                WHERE f.company_id = co AND f.deleted_at IS NULL AND (d.id IS NOT NULL OR x.id IS NOT NULL)),
         u AS (UPDATE fin_cheque f SET branch_id = t.branch_id FROM t WHERE f.id = t.id AND f.branch_id IS DISTINCT FROM t.branch_id RETURNING t.tax_no, f.cheque_no)
    INSERT INTO ocio196_moved SELECT phase, 'cheque', tax_no, NULL, cheque_no FROM u;
    GET DIAGNOSTICS n_chq = ROW_COUNT;
    t_doc := t_doc + n_doc; t_jnl := t_jnl + n_jnl; t_vat := t_vat + n_vat; t_wht := t_wht + n_wht; t_chq := t_chq + n_chq;
  END LOOP;

  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE doc_header ENABLE TRIGGER USER;
  ALTER TABLE gl_journal ENABLE TRIGGER USER;
  ALTER TABLE tax_vat_entry ENABLE TRIGGER USER;
  ALTER TABLE tax_wht_entry ENABLE TRIGGER USER;
  ALTER TABLE fin_cheque ENABLE TRIGGER USER;
  SET CONSTRAINTS ALL DEFERRED;

  IF t_doc + t_jnl + t_vat + t_wht + t_chq > 0 THEN
    INSERT INTO sys_activity_log (company_id, module, action, table_name, detail)
    SELECT co, 'SYS', 'BRANCH_FIX', 'doc_header', jsonb_build_object(
      'handoff', 196, 'by', 'ocio196_branch_fix() (migration 0081 · owner 26/11/2569)',
      'rule', '1) Express doc no letters+NN (01-99) = branch tax no 000NN, others stay at head office; 2) receipts/payments follow the settled invoices when all are on one branch; 3) cheque deposit slips follow their cheques when all are on one branch',
      'docs', t_doc, 'journals', t_jnl, 'vat', t_vat, 'wht', t_wht, 'cheques', t_chq,
      'by_branch', (SELECT jsonb_object_agg(b.tax_no, b.detail) FROM (
          SELECT m.tax_no, jsonb_build_object(
            'docs', count(*) FILTER (WHERE m.kind = 'doc'), 'journals', count(*) FILTER (WHERE m.kind = 'journal'),
            'vat', count(*) FILTER (WHERE m.kind = 'vat'), 'wht', count(*) FILTER (WHERE m.kind = 'wht'), 'cheques', count(*) FILTER (WHERE m.kind = 'cheque'),
            'by_prefix', (SELECT jsonb_object_agg(p.prefix, p.n) FROM (SELECT m2.prefix, count(*) AS n FROM ocio196_moved m2 WHERE m2.kind = 'doc' AND m2.tax_no = m.tax_no GROUP BY m2.prefix) p),
            'doc_nos', (SELECT jsonb_agg(m3.no ORDER BY m3.phase, m3.no) FROM ocio196_moved m3 WHERE m3.kind = 'doc' AND m3.tax_no = m.tax_no)) AS detail
            FROM ocio196_moved m GROUP BY m.tax_no) b));
  END IF;

  DROP TABLE ocio196_doc; DROP TABLE ocio196_jnl; DROP TABLE ocio196_moved;
  RETURN format('moved docs %s, journals %s, vat %s, wht %s, cheques %s', t_doc, t_jnl, t_vat, t_wht, t_chq);
END
$ocio196$;
SELECT ocio196_branch_fix();
