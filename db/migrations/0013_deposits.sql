-- T3.6 มัดจำรับ/จ่าย: ยอดมัดจำคงเหลือคำนวณสดจากการหักในบิล (กติกาข้อ 8 — ไม่เก็บยอดสะสม)
-- มัดจำคงเหลือรายใบ (AI/AE) = ยอดมัดจำ (ตามประเภทราคาของใบมัดจำ) − ที่หักในบิลแล้ว (doc_link DEPOSIT ไปเอกสารที่ไม่ยกเลิก)
CREATE OR REPLACE VIEW v_deposit_outstanding WITH (security_invoker = true) AS
SELECT h.company_id, h.module, h.customer_id, h.supplier_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.due_date, h.price_type,
       h.amount, COALESCE(u.used, 0) AS used, h.amount - COALESCE(u.used, 0) AS outstanding
FROM doc_header h
LEFT JOIN (SELECT l.from_header_id, sum(l.amount) used FROM doc_link l JOIN doc_header t ON t.id = l.to_header_id
            WHERE l.link_type = 'DEPOSIT' AND l.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL GROUP BY 1) u
       ON u.from_header_id = h.id
WHERE h.doc_class IN ('AI','AE') AND h.doc_status <> 'C' AND h.deleted_at IS NULL;
