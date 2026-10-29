-- T3.7 ใบสั่งขาย/ใบสั่งซื้อ: ยอดค้างส่ง/ค้างรับรายบรรทัดคำนวณสด (กติกาข้อ 8)
-- ใบสั่งขาย/ใบสั่งซื้อรายบรรทัด: ยอดค้างส่ง/ค้างรับ = สั่ง − ยกเลิก − ส่งแล้ว (บรรทัดบิลที่อ้าง source_line_id ในเอกสารที่ไม่ยกเลิก)
-- บรรทัดที่ย้ายจาก Express มี remaining_qty (REMQTY ณ วันย้าย) เป็นยอดตั้งต้น
CREATE OR REPLACE VIEW v_order_line WITH (security_invoker = true) AS
SELECT l.company_id, h.id AS header_id, h.doc_class, h.doc_no, h.doc_date, h.customer_id, h.supplier_id, h.price_type,
       l.id AS line_id, l.line_no, l.item_id, l.description, l.warehouse_id, l.unit_id, l.factor, l.unit_price, l.discount_text, l.is_free, l.delivery_date,
       COALESCE(l.ordered_qty, l.qty) AS ordered_qty, COALESCE(l.cancelled_qty, 0) AS cancelled_qty, COALESCE(dl.delivered, 0) AS delivered_qty,
       CASE WHEN l.remaining_qty IS NOT NULL THEN l.remaining_qty - COALESCE(dl.delivered, 0)
            ELSE COALESCE(l.ordered_qty, l.qty) - COALESCE(l.cancelled_qty, 0) - COALESCE(dl.delivered, 0) END AS remaining_qty
FROM doc_line l JOIN doc_header h ON h.id = l.header_id
LEFT JOIN (SELECT s.source_line_id, sum(s.qty) delivered FROM doc_line s JOIN doc_header t ON t.id = s.header_id
            WHERE s.source_line_id IS NOT NULL AND s.deleted_at IS NULL AND t.doc_status <> 'C' AND t.deleted_at IS NULL GROUP BY 1) dl
       ON dl.source_line_id = l.id
WHERE h.doc_class IN ('SO','PO') AND h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL;
