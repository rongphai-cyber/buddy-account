-- T3.5 รับชำระ/จ่ายชำระ: วันที่รับ/จ่ายเงินจริง + แก้ยอดคงค้าง
-- ยอดตัดของใบลดหนี้ (CN/DN) เก็บเป็นบวก — เดิม view ลบซ้ำทำให้ใบลดหนี้ที่ตัดแล้วกลับค้างติดลบเท่าตัว (ลูกหนี้ DEMO ต่าง 3.27 ล้าน)
-- และไม่นับรายการตัดของใบเสร็จ/ใบสำคัญจ่ายที่ยกเลิก (ยกเลิก = สถานะ C ไม่ลบ)
ALTER TABLE doc_header ADD COLUMN payment_date date;
COMMENT ON COLUMN doc_header.payment_date IS 'วันที่รับ/จ่ายเงินจริง (ใบเสร็จ RE / ใบสำคัญจ่าย PS) — ไม่จำเป็นต้องตรงวันที่เอกสาร';

CREATE OR REPLACE VIEW v_ar_outstanding WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW v_ap_outstanding WITH (security_invoker = true) AS
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
